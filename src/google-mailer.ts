import {Admin,Public,Auth,digest} from './security.js';
import {BadRequestException,Body,Controller,Get,Header,Injectable,Post,Req,ServiceUnavailableException,UnauthorizedException} from '@nestjs/common';
import {createPrivateKey,createPublicKey,generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {EncryptJWT,SignJWT,jwtDecrypt,jwtVerify} from 'jose';
import {z} from 'zod';
import {persisted,schoolKey,safeOrigin} from './config.js';
import {Database} from './database.js';
import {SettingsService} from './settings.js';
import {sealToken,openToken} from './appsscript.js';
const token=z.string().regex(/^[\x21-\x7e]{10,10000}$/);
const bundleSchema=z.object({accessToken:token,refreshToken:token.optional(),expiresAt:z.number().int(),email:z.string().email().max(254).optional(),connectId:z.string().regex(/^[a-f0-9]{64}$/).optional(),requestId:z.string().uuid().optional()}).passthrough();
@Injectable()
export class GoogleMailer {
 private refreshing?:Promise<string>;
 constructor(readonly db:Database,readonly settings:SettingsService,readonly auth:Auth){}
 private encryptionKey(){return createPrivateKey(persisted('gmail-encryption.pem',()=>generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'}) as string));}
 private publicKey(){return createPublicKey(this.encryptionKey()).export({format:'pem',type:'spki'}) as string;}
 private async central(path:string,body?:unknown){const s=await this.settings.ready();const response=await fetch(new URL(path,safeOrigin(s.centralUrl)),{method:body?'POST':'GET',redirect:'error',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('Central mailer unavailable');const text=await response.text();if(text.length>65536)throw new Error('Response too large');return JSON.parse(text);}
 async signed(action:string,claims:Record<string,unknown>,jti=randomUUID()){const s=await this.settings.ready();return {assertion:await new SignJWT({...claims,action}).setProtectedHeader({alg:'EdDSA',typ:'JWT'}).setIssuer(s.schoolCode).setAudience(s.centralUrl).setIssuedAt().setExpirationTime('5m').setJti(jti).sign(schoolKey())};}
 private async verifyAssertion(body:unknown,audience:string){const b=z.object({assertion:z.string().min(1).max(32768)}).strict().parse(body),s=await this.settings.ready();const p=(await jwtVerify(b.assertion,this.auth.resolver(s.centralUrl),{algorithms:['EdDSA'],issuer:s.centralUrl,audience,requiredClaims:['iat','exp','jti'],maxTokenAge:'5m'})).payload;if(p.purpose!=='gmail-broker'||!p.iat||!p.exp||p.exp-p.iat>300||!p.jti)throw new Error('Invalid broker assertion');return p;}
 private async bundle(body:unknown){const s=await this.settings.ready(),outer=await this.verifyAssertion(body,s.schoolCode);if(typeof outer.encrypted!=='string')throw new Error('Invalid bundle');const p=(await jwtDecrypt(outer.encrypted,this.encryptionKey(),{keyManagementAlgorithms:['RSA-OAEP-256'],contentEncryptionAlgorithms:['A256GCM'],issuer:s.centralUrl,audience:s.schoolCode,requiredClaims:['iat','exp','jti'],maxTokenAge:'5m'})).payload;const value=bundleSchema.parse(p);if(value.expiresAt<=Date.now()+30000||value.expiresAt>Date.now()+7200000)throw new Error('Invalid expiry');await this.db.mailerNonces.create({keyId:'google-broker',nonce:outer.jti,expiresAt:new Date(outer.exp!*1000+300000)});return value;}
 async connect(req:any){
  try{
   const s=await this.settings.ready(),sessionHash=digest(req.headers.authorization.slice(7)),session=await this.db.sessions.findOne({hash:sessionHash,schoolAdmin:true,expiresAt:{$gt:new Date()}}).lean<any>();if(!session||session.sub!==req.identity.sub)throw new Error();
   const origin=safeOrigin(req.headers.origin);if(!s.corsOrigins.includes(origin))throw new Error('Web origin not allowed');
   const connectId=randomBytes(32).toString('hex'),keyId=randomBytes(16).toString('hex'),salt=randomBytes(32).toString('base64url');
   await this.db.mailerStates.updateOne({key:'google'},{$set:{pending:{connectId,sessionHash,sub:session.sub,expiresAt:new Date(Date.now()+600000)},pendingKeyId:keyId,pendingSalt:salt}},{upsert:true});
   const result=await this.central('/mailer/google/connect',await this.signed('connect',{connectId,encryptionPublicKey:this.publicKey(),returnOrigin:origin}));
   const url=new URL(result.url);if(url.origin!==s.centralUrl||url.pathname!=='/mailer/google/start')throw new Error('Invalid connect URL');return {url:url.href};
  }catch{throw new ServiceUnavailableException('Google mailer connection failed');}
 }
 async callback(body:unknown){
  try{
   const p=await this.bundle(body);if(!p.connectId||!p.refreshToken||!p.email)throw new Error();
   const state=await this.db.mailerStates.findOne({key:'google','pending.connectId':p.connectId,'pending.expiresAt':{$gt:new Date()}}).lean<any>();if(!state)throw new Error();
   // Check the actual initiating session, without creating or exchanging any session.
   const initiating=await this.db.sessions.findOne({hash:state.pending.sessionHash,sub:state.pending.sub,schoolAdmin:true,expiresAt:{$gt:new Date()}}).lean<any>();if(!initiating)throw new Error();
   const user=await this.db.users.findOne({sub:initiating.sub,banned:{$ne:true}}).lean<any>();if(!user)throw new Error();
   const changed=await this.db.mailerStates.updateOne({key:'google','pending.connectId':p.connectId,'pending.expiresAt':{$gt:new Date()}},{$set:{keyId:state.pendingKeyId,salt:state.pendingSalt,email:p.email,token:sealToken(p.accessToken,state.pendingSalt),refreshToken:sealToken(p.refreshToken,state.pendingSalt),expiresAt:new Date(p.expiresAt)},$unset:{pending:1,pendingKeyId:1,pendingSalt:1}});if(changed.modifiedCount!==1)throw new Error();
   return {ok:true};
  }catch{throw new UnauthorizedException('Invalid Google mailer callback');}
 }
 async status(){const s=await this.db.mailerStates.findOne({key:'google'}).lean<any>();return {connected:!!s?.refreshToken,email:s?.email??null,expiresAt:s?.expiresAt?.toISOString()??null};}
 async disconnect(){
  const state=await this.db.mailerStates.findOne({key:'google'}).lean<any>();
  if(!state?.refreshToken){await this.db.mailerStates.deleteOne({key:'google',refreshToken:{$exists:false}});return {ok:true};}
  try{
   const s=await this.settings.ready(),keyAssertion=await this.verifyAssertion(await this.central('/mailer/google/key'),'carpschool-gmail-broker');if(typeof keyAssertion.publicKey!=='string')throw new Error();
   const requestId=randomUUID(),encrypted=await new EncryptJWT({refreshToken:openToken(state.refreshToken,state.salt),requestId}).setProtectedHeader({alg:'RSA-OAEP-256',enc:'A256GCM',typ:'JWT'}).setIssuer(s.schoolCode).setAudience(s.centralUrl).setIssuedAt().setExpirationTime('5m').setJti(requestId).encrypt(createPublicKey(keyAssertion.publicKey));
   const ack=await this.verifyAssertion(await this.central('/mailer/google/revoke',await this.signed('revoke',{encrypted},requestId)),s.schoolCode);if(ack.requestId!==requestId||ack.revoked!==true)throw new Error();
   await this.db.mailerStates.deleteOne({key:'google',keyId:state.keyId});return {ok:true};
  }catch{throw new ServiceUnavailableException('Google mailer disconnect failed');}
 }
 async email(){const s=await this.db.mailerStates.findOne({key:'google'}).lean<any>();if(!s?.email||!s.refreshToken)throw new ServiceUnavailableException('Google mailer not connected');return s.email as string;}
 async accessToken(){const s=await this.db.mailerStates.findOne({key:'google'}).lean<any>();if(!s?.refreshToken)throw new ServiceUnavailableException('Google mailer not connected');if(s.token&&s.expiresAt?.getTime()>Date.now()+60000)return openToken(s.token,s.salt);if(!this.refreshing)this.refreshing=this.refresh(s).finally(()=>{this.refreshing=undefined;});return this.refreshing;}
 private async refresh(state:any){
  try{
   const s=await this.settings.ready(),keyAssertion=await this.verifyAssertion(await this.central('/mailer/google/key'),'carpschool-gmail-broker');if(typeof keyAssertion.publicKey!=='string')throw new Error();
   const requestId=randomUUID(),encrypted=await new EncryptJWT({refreshToken:openToken(state.refreshToken,state.salt),requestId}).setProtectedHeader({alg:'RSA-OAEP-256',enc:'A256GCM',typ:'JWT'}).setIssuer(s.schoolCode).setAudience(s.centralUrl).setIssuedAt().setExpirationTime('5m').setJti(requestId).encrypt(createPublicKey(keyAssertion.publicKey));
   const p=await this.bundle(await this.central('/mailer/google/refresh',await this.signed('refresh',{encrypted,encryptionPublicKey:this.publicKey()},requestId)));if(p.requestId!==requestId)throw new Error();
   const changed=await this.db.mailerStates.updateOne({key:'google',keyId:state.keyId},{$set:{token:sealToken(p.accessToken,state.salt),expiresAt:new Date(p.expiresAt),...(p.refreshToken?{refreshToken:sealToken(p.refreshToken,state.salt)}:{})}});if(changed.modifiedCount!==1)throw new Error();return p.accessToken;
  }catch{throw new ServiceUnavailableException('Google mailer refresh failed');}
 }
}
@Controller()
export class GoogleMailerController {
 constructor(readonly google:GoogleMailer){}
 @Admin() @Post('admin/mailer/google/connect') @Header('Cache-Control','no-store') connect(@Req() r:any){return this.google.connect(r);}
 @Admin() @Get('admin/mailer/google/status') @Header('Cache-Control','no-store') status(){return this.google.status();}
 @Admin() @Post('admin/mailer/google/disconnect') @Header('Cache-Control','no-store') disconnect(){return this.google.disconnect();}
 @Public() @Post('mailer/google/callback') @Header('Cache-Control','no-store') callback(@Body() b:unknown){return this.google.callback(b);}
}
