import {Injectable,UnauthorizedException,ServiceUnavailableException,ConflictException} from '@nestjs/common';
import {createHash,createCipheriv,createDecipheriv,generateKeyPairSync,hkdfSync,randomBytes,verify} from 'node:crypto';
import {z} from 'zod';
import {Database} from './database.js';
import {schoolKey,safeOrigin} from './config.js';
import {SettingsService} from './settings.js';
import {generateScript} from './appsscript-generator.js';
const b64=z.string().regex(/^[A-Za-z0-9_-]+$/);
export const tokenEnvelope=z.object({ciphertext:b64.min(24).max(16000),iv:b64.length(16),ts:z.number().int().min(1000000000000).max(9999999999999),signature:b64.length(342)}).strict();
const payload=z.object({token:z.string().min(10).max(10000).regex(/^[\x21-\x7e]+$/),expiresAt:z.number().int(),ts:z.number().int(),nonce:z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)}).strict();
export function deriveKey(salt:string,info='carpschool-appsscript-aes'){
 return Buffer.from(hkdfSync('sha256',schoolKey().export({format:'der',type:'pkcs8'}),Buffer.from(salt,'base64url'),Buffer.from(info),32));
}
function decode(s:string){const b=Buffer.from(s,'base64url');if(b.toString('base64url')!==s)throw new Error('Noncanonical encoding');return b;}
export function sealToken(token:string,salt:string){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',deriveKey(salt,'carpschool-appsscript-at-rest'),iv);return {iv:iv.toString('base64url'),ciphertext:Buffer.concat([c.update(token,'utf8'),c.final(),c.getAuthTag()]).toString('base64url')};}
export function openToken(box:{iv:string;ciphertext:string},salt:string){const data=decode(box.ciphertext),d=createDecipheriv('aes-256-gcm',deriveKey(salt,'carpschool-appsscript-at-rest'),decode(box.iv));d.setAuthTag(data.subarray(-16));return Buffer.concat([d.update(data.subarray(0,-16)),d.final()]).toString('utf8');}
@Injectable()
export class AppsScriptTokens {
 constructor(readonly db:Database,readonly settings:SettingsService){}
 async state(){return this.db.mailerStates.findOne({key:'appsscript'}).lean<any>();}
 async generate(regenerate=false){
  const prior=await this.state();if(prior&&!regenerate)throw new ConflictException('Confirm regeneration to invalidate the existing script');
  const s=await this.settings.ready();if(!s.publicUrl)throw new ServiceUnavailableException('Public school URL required');
  const origin=safeOrigin(s.publicUrl),salt=randomBytes(32).toString('base64url'),keyId=randomBytes(16).toString('hex');
  const keys=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
  const script=generateScript({endpoint:origin+'/mailer/appsscript/token',aesKey:deriveKey(salt),rsaPrivateKey:keys.privateKey,keyId});
  // One atomic replacement invalidates every outstanding token and old script. No script private key stored.
  if(prior){
   const updated=await this.db.mailerStates.updateOne({key:'appsscript',keyId:prior.keyId},{$set:{keyId,salt,publicKey:keys.publicKey,ivCounter:0},$unset:{token:1,expiresAt:1,lastPushAt:1,lastTs:1}});
   if(updated.modifiedCount!==1)throw new ConflictException('Concurrent regeneration');
  }else{
   try{await this.db.mailerStates.create({key:'appsscript',keyId,salt,publicKey:keys.publicKey,ivCounter:0});}catch{throw new ConflictException('Concurrent generation');}
  }
  return {...script,keyId};
 }
 async status(){const s=await this.state();return {generated:!!s,keyId:s?.keyId??null,tokenSet:!!s?.token,tokenValid:!!(s?.token&&s.expiresAt&&s.expiresAt.getTime()>Date.now()+30000),expiresAt:s?.expiresAt?.toISOString()??null,lastPushAt:s?.lastPushAt?.toISOString()??null};}
 async accept(input:unknown){
  try{
   const e=tokenEnvelope.parse(input),now=Date.now();if(Math.abs(now-e.ts)>300000)throw new Error('Stale');
   const s=await this.state();if(!s)throw new Error('No keys');
   const ciphertext=decode(e.ciphertext),iv=decode(e.iv),signature=decode(e.signature);
   if(iv.length!==12||signature.length!==256||ciphertext.length<17)throw new Error('Bad lengths');
   // Verify before AES decryption. Signature covers canonical ASCII concatenation.
   if(!verify('RSA-SHA256',Buffer.from(e.ciphertext+e.iv+String(e.ts),'ascii'),s.publicKey,signature))throw new Error('Bad signature');
   const d=createDecipheriv('aes-256-gcm',deriveKey(s.salt),iv);d.setAuthTag(ciphertext.subarray(-16));
   const p=payload.parse(JSON.parse(Buffer.concat([d.update(ciphertext.subarray(0,-16)),d.final()]).toString('utf8')));
   if(p.ts!==e.ts||p.expiresAt<=now+30000||p.expiresAt>now+3600000||p.expiresAt<=p.ts||p.expiresAt>p.ts+3600000)throw new Error('Bad expiry');
   const consumed=await this.db.mailerNonces.updateOne({keyId:s.keyId,nonce:'reserved-iv:'+e.iv,reservationNonce:p.nonce,reservedTs:e.ts,validUntil:{$gt:new Date(now)},consumed:false},{$set:{consumed:true}});
   if(consumed.modifiedCount!==1)throw new Error('Missing, expired or consumed reservation');
   await this.db.mailerNonces.create({keyId:s.keyId,nonce:'used-iv:'+e.iv});
   await this.db.mailerNonces.create({keyId:s.keyId,nonce:p.nonce,expiresAt:new Date(e.ts+600000)});
   const changed=await this.db.mailerStates.updateOne({key:'appsscript',keyId:s.keyId,$or:[{lastTs:{$exists:false}},{lastTs:{$lt:e.ts}}]},{$set:{token:sealToken(p.token,s.salt),expiresAt:new Date(p.expiresAt),lastPushAt:new Date(now),lastTs:e.ts}});
   if(changed.modifiedCount!==1)throw new Error('Rotated or old token');
   return {ok:true};
  }catch{throw new UnauthorizedException('Invalid token push');}
 }
 async reserveIv(input:unknown){
  try{
   const e=z.object({keyId:z.string().regex(/^[0-9a-f]{32}$/),ts:z.number().int().min(1000000000000).max(9999999999999),nonce:z.string().uuid(),signature:b64.length(342)}).strict().parse(input);
   if(Math.abs(Date.now()-e.ts)>300000)throw new Error('Stale');
   const state=await this.state();if(!state||state.keyId!==e.keyId)throw new Error('Rotated');
   const sig=decode(e.signature);if(sig.length!==256||!verify('RSA-SHA256',Buffer.from('carpschool-appsscript-iv:'+e.keyId+':'+e.ts+':'+e.nonce,'ascii'),state.publicKey,sig))throw new Error('Bad signature');
   await this.db.mailerNonces.create({keyId:e.keyId,nonce:'iv:'+e.nonce,expiresAt:new Date(e.ts+600000)});
   // Supply Node CSPRNG entropy; Apps Script UUIDs are request IDs, not IV entropy.
   // No TTL on reservation records, so copied scripts and process restarts cannot reuse an IV.
   for(let attempt=0;attempt<8;attempt++){
    const iv=randomBytes(12).toString('base64url');
    try{await this.db.mailerNonces.create({keyId:e.keyId,nonce:'reserved-iv:'+iv,reservationNonce:e.nonce,reservedTs:e.ts,validUntil:new Date(Math.min(e.ts+300000,Date.now()+300000)),consumed:false});}
    catch(error){if((error as {code?:number}).code===11000)continue;throw error;}
    if((await this.state())?.keyId!==e.keyId)throw new Error('Rotated');
    return {iv};
   }
   throw new Error('IV allocation failed');
  }catch{throw new UnauthorizedException('Invalid IV reservation');}
 }
 async accessToken(){const s=await this.state();if(!s?.token||!s.expiresAt||s.expiresAt.getTime()<=Date.now()+30000)throw new ServiceUnavailableException('Apps Script token unavailable or expired');try{return openToken(s.token,s.salt);}catch{throw new ServiceUnavailableException('Apps Script token unavailable or expired');}}
}
