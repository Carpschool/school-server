import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, ForbiddenException, SetMetadata, ConflictException, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createRemoteJWKSet, jwtVerify, createLocalJWKSet } from 'jose';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Database } from './database.js';
import { loadConfig, otpPepper } from './config.js';
import { SettingsService } from './settings.js';
export const Public=()=>SetMetadata('public',true);
/** Reachable before the school is claimed. */
export const SetupOpen=()=>SetMetadata('setup',true);
export const Admin=()=>SetMetadata('admin',true);
export const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
export const hashCode=(code:string)=>{const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(code+otpPepper(),salt,32).toString('hex');};
export const compareCode=(code:string,hash:string)=>{const [salt,value]=hash.split(':');if(!salt||!value)return false;const stored=Buffer.from(value,'hex');const derived=scryptSync(code+otpPepper(),salt,32);return stored.length===derived.length&&timingSafeEqual(stored,derived);};
export type Identity={sub:string;schoolAdmin:boolean;expiresAt:Date};
@Injectable()
export class Auth implements OnModuleInit {
 local?: ReturnType<typeof createLocalJWKSet>; remote?:{url:string;set:ReturnType<typeof createRemoteJWKSet>};
 constructor(readonly db:Database,readonly settings:SettingsService){}
 onModuleInit(){if(loadConfig().NODE_ENV==='test'&&process.env.TEST_JWKS_PATH)this.local=createLocalJWKSet(JSON.parse(readFileSync(process.env.TEST_JWKS_PATH,'utf8')));}
 /** Central is pinned in DB at claim time; issuer is its origin. */
 resolver(central:string){if(this.local)return this.local;if(this.remote?.url!==central)this.remote={url:central,set:createRemoteJWKSet(new URL('/.well-known/jwks.json',central),{timeoutDuration:5000})};return this.remote.set;}
 async exchange(ticket:string){
  const s=await this.settings.ready();
  let p;
  try{p=(await jwtVerify(ticket,this.resolver(s.centralUrl),{algorithms:['EdDSA'],issuer:s.centralUrl,audience:s.schoolCode,requiredClaims:['sub','exp','iat','jti'],maxTokenAge:'16m'})).payload;}catch{throw new UnauthorizedException('Invalid federation ticket');}
  if(!p.sub||!p.jti||!p.exp||!p.iat||p.exp-p.iat>960)throw new UnauthorizedException('Invalid ticket claims');
  const expiresAt=new Date(p.exp*1000);
  try{await this.db.replays.create({jti:p.jti,expiresAt});}catch{throw new ConflictException('Ticket already exchanged');}
  await this.db.users.updateOne({sub:p.sub},{$setOnInsert:{sub:p.sub},$set:{avatar:typeof p.avatar==='string'?p.avatar:''}},{upsert:true});
  const token=randomBytes(32).toString('base64url');
  await this.db.sessions.create({hash:digest(token),sub:p.sub,schoolAdmin:p.schoolAdmin===true,expiresAt});
  return {token,expiresAt};
 }
 async authenticate(token:string):Promise<Identity>{
  const s=await this.db.sessions.findOne({hash:digest(token),expiresAt:{$gt:new Date()}}).lean<any>();
  if(!s)throw new UnauthorizedException('Session expired');
  const u=await this.db.users.findOne({sub:s.sub}).lean<any>();if(!u||u.banned)throw new ForbiddenException('Account unavailable');
  return {sub:s.sub,schoolAdmin:s.schoolAdmin===true,expiresAt:s.expiresAt};
 }
}
@Injectable()
export class AuthGuard implements CanActivate {
 constructor(readonly auth:Auth,readonly reflector:Reflector){}
 async canActivate(ctx:ExecutionContext){
  if(ctx.getType()==='http'&&!this.reflector.getAllAndOverride('setup',[ctx.getHandler(),ctx.getClass()])&&!(await this.auth.settings.get()).configured)throw new ServiceUnavailableException('School server not set up yet');
  if(this.reflector.getAllAndOverride('public',[ctx.getHandler(),ctx.getClass()]))return true;
  const req=ctx.switchToHttp().getRequest();
  const token=/^Bearer ([A-Za-z0-9_-]+)$/.exec(req.headers.authorization||'')?.[1];
  if(!token)throw new UnauthorizedException('Bearer school session required');
  req.identity=await this.auth.authenticate(token);
  if(this.reflector.getAllAndOverride('admin',[ctx.getHandler(),ctx.getClass()])&&!req.identity.schoolAdmin)throw new ForbiddenException('School admin required');
  return true;
 }
}
