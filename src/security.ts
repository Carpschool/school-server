import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, ForbiddenException, SetMetadata, ConflictException, OnModuleInit } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createRemoteJWKSet, jwtVerify, createLocalJWKSet } from 'jose';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Database } from './database.js';
import { loadConfig } from './config.js';
export const Public=()=>SetMetadata('public',true);
export const Admin=()=>SetMetadata('admin',true);
export const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
export const hashCode=(code:string)=>{const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(code+loadConfig().OTP_PEPPER,salt,32).toString('hex');};
export const compareCode=(code:string,hash:string)=>{const [salt,value]=hash.split(':');if(!salt||!value)return false;const stored=Buffer.from(value,'hex');const derived=scryptSync(code+loadConfig().OTP_PEPPER,salt,32);return stored.length===derived.length&&timingSafeEqual(stored,derived);};
export type Identity={sub:string;schoolAdmin:boolean;expiresAt:Date};
@Injectable()
export class Auth implements OnModuleInit {
 resolver!: ReturnType<typeof createRemoteJWKSet> | ReturnType<typeof createLocalJWKSet>;
 constructor(readonly db:Database){}
 onModuleInit(){
  const c=loadConfig();
  this.resolver=c.NODE_ENV==='test'&&process.env.TEST_JWKS_PATH ? createLocalJWKSet(JSON.parse(readFileSync(process.env.TEST_JWKS_PATH,'utf8'))) : createRemoteJWKSet(new URL('/.well-known/jwks.json',c.CENTRAL_URL),{timeoutDuration:5000});
 }
 async exchange(ticket:string){
  let p;
  try{p=(await jwtVerify(ticket,this.resolver,{algorithms:['EdDSA'],issuer:loadConfig().CENTRAL_ISSUER,audience:loadConfig().SCHOOL_CODE,requiredClaims:['sub','exp','iat','jti'],maxTokenAge:'16m'})).payload;}catch{throw new UnauthorizedException('Invalid federation ticket');}
  if(!p.sub||!p.jti||!p.exp||!p.iat||p.exp-p.iat>960)throw new UnauthorizedException('Invalid ticket claims');
  const expiresAt=new Date(p.exp*1000);
  try{await this.db.replays.create({jti:p.jti,expiresAt});}catch{throw new ConflictException('Ticket already exchanged');}
  await this.db.users.updateOne({sub:p.sub},{$setOnInsert:{sub:p.sub}},{upsert:true});
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
  if(this.reflector.getAllAndOverride('public',[ctx.getHandler(),ctx.getClass()]))return true;
  const req=ctx.switchToHttp().getRequest();
  const token=/^Bearer ([A-Za-z0-9_-]+)$/.exec(req.headers.authorization||'')?.[1];
  if(!token)throw new UnauthorizedException('Bearer school session required');
  req.identity=await this.auth.authenticate(token);
  if(this.reflector.getAllAndOverride('admin',[ctx.getHandler(),ctx.getClass()])&&!req.identity.schoolAdmin)throw new ForbiddenException('School admin required');
  return true;
 }
}
