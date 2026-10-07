import { Injectable, Logger, OnApplicationBootstrap, ConflictException, UnauthorizedException, BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { createHash, randomBytes, sign, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';
import { SettingsService, schoolCode } from './settings.js';
import { safeOrigin, schoolKey, schoolPublicKey } from './config.js';
export const claimDto=z.object({
 code:z.string().regex(/^[0-9a-f]{7}$/i),
 assertion:z.string().min(20).max(8000),
 nonce:z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
}).strict();
const assertionClaims=z.object({schoolCode,publicUrl:z.string().max(2048),nonce:z.string(),name:z.string().trim().min(2).max(200).optional()}).passthrough();
/**
 * First-run bootstrap. An unconfigured school prints a one-time setup code to its logs
 * (first 7 hex of sha256 over 64 KiB of randomness). A central admin enters that code in the
 * central web "Add school" form; central then POSTs /setup/claim with the code plus a JWT it
 * signed (iss = central origin). We verify the JWT against that central's JWKS, pin the central,
 * store the identity settings, sign the nonce with our persistent key and burn the code.
 * 28-bit code, so: constant-time compare, at most 5 attempts per 10 min, and after 5 bad codes
 * the endpoint locks for 15 min and the code is replaced (old guesses become worthless).
 */
@Injectable()
export class SetupService implements OnApplicationBootstrap {
 readonly logger=new Logger('Setup');
 code?:string; window:{start:number;n:number}={start:0,n:0}; failures=0; lockedUntil=0; busy=false;
 constructor(readonly settings:SettingsService){}
 async onApplicationBootstrap(){if(!(await this.settings.get()).configured)this.rotate();}
 rotate(){this.code=createHash('sha256').update(randomBytes(65536)).digest('hex').slice(0,7);this.failures=0;this.logger.warn('School server is not set up. One-time setup code: '+this.code+' (enter it in Carpschool central admin, Add school)');}
 limit(){const now=Date.now();if(now<this.lockedUntil)throw new HttpException('Setup locked after failed attempts; a new code is in the server log. Try again later.',HttpStatus.TOO_MANY_REQUESTS);if(now-this.window.start>600_000)this.window={start:now,n:0};if(++this.window.n>5)throw new HttpException('Too many setup attempts, wait 10 minutes',HttpStatus.TOO_MANY_REQUESTS);}
 status(){return {setup:!this.code?false:true};}
 async claim(body:z.infer<typeof claimDto>,jwks?:Parameters<typeof jwtVerify>[1]){
  if((await this.settings.get()).configured||!this.code)throw new ConflictException('School already set up');
  this.limit();
  if(this.busy)throw new ConflictException('Claim in progress');
  const a=Buffer.from(body.code.toLowerCase()),b=Buffer.from(this.code);
  if(a.length!==b.length||!timingSafeEqual(a,b)){if(++this.failures>=5){this.lockedUntil=Date.now()+900_000;this.logger.warn('5 bad setup codes: claim locked for 15 minutes');this.rotate();}throw new UnauthorizedException('Invalid setup code');}
  this.busy=true;
  try{
   let iss:string;
   try{iss=safeOrigin(String(JSON.parse(Buffer.from(body.assertion.split('.')[1]||'','base64url').toString()).iss));}catch{throw new BadRequestException('Assertion issuer must be an HTTPS central origin');}
   let p:any;
   try{p=(await jwtVerify(body.assertion,jwks??createRemoteJWKSet(new URL('/.well-known/jwks.json',iss),{timeoutDuration:5000}),{algorithms:['EdDSA'],issuer:iss,audience:'carpschool-setup',maxTokenAge:'5m'})).payload;}catch{throw new UnauthorizedException('Central assertion rejected');}
   const c=assertionClaims.safeParse(p);if(!c.success||c.data.nonce!==body.nonce)throw new BadRequestException('Invalid assertion claims');
   let publicUrl:string;try{publicUrl=safeOrigin(c.data.publicUrl);}catch{throw new BadRequestException('Invalid public URL');}
   await this.settings.claim({schoolCode:c.data.schoolCode,centralUrl:iss,publicUrl,name:c.data.name});
   this.code=undefined;this.logger.log('Claimed by '+iss+' as '+c.data.schoolCode+'; setup code destroyed');
   return {schoolCode:c.data.schoolCode,publicKey:schoolPublicKey(),signature:sign(null,Buffer.from(body.nonce),schoolKey()).toString('base64url')};
  }finally{this.busy=false;}
 }
}
