import { Injectable, ServiceUnavailableException, BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { RE2JS } from 're2js';
import { Database } from './database.js';
import { loadConfig, safeOrigin } from './config.js';
const domain=z.string().trim().toLowerCase().regex(/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/);
const secret=z.string().trim().min(1).max(2048);
/** Only deployed Google Apps Script web apps may receive mailer secrets. */
export function validAppsScriptUrl(value:string){return /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(value);}
const appsScriptUrl=z.string().trim().max(2048).refine(validAppsScriptUrl,'Google Apps Script HTTPS deployment URL required');
const origin=z.string().trim().max(2048).refine(o=>{try{safeOrigin(o);return true;}catch{return false;}},'HTTPS origin required').transform(o=>safeOrigin(o));
/** RE2 (linear time, no backtracking) so admin regexes can't ReDoS the server. */
const reCache=new Map<string,any>();
export function compileEmailRegex(p:string){let r=reCache.get(p);if(!r){if(p.length>200)throw new Error('too long');r=RE2JS.compile('^(?:'+p+')$',RE2JS.CASE_INSENSITIVE);if(reCache.size>200)reCache.clear();reCache.set(p,r);}return r;}
/** One allowed-email rule. Regex is matched against the FULL email, anchored ^(?:...)$, case-insensitive, via RE2 (linear time: no ReDoS). */
export const emailRuleItem=z.discriminatedUnion('type',[
 z.object({type:z.literal('domain'),value:domain}).strict(),
 z.object({type:z.literal('regex'),value:z.string().min(1).max(200).superRefine((p,ctx)=>{try{compileEmailRegex(p);}catch(e:any){ctx.addIssue({code:z.ZodIssueCode.custom,message:'Invalid regex: '+String(e?.message||e).replace(/^error parsing regexp: /i,'').replace(/: `.*`$/,'')+' (RE2 syntax: no lookarounds or backreferences)'});}})}).strict(),
]);
export const emailRules=z.array(emailRuleItem).min(1).max(50).transform(r=>r.filter((x,i)=>r.findIndex(y=>y.type===x.type&&y.value===x.value)===i));
export function ruleMatches(rules:z.infer<typeof emailRules>,email:string){
 const e=email.trim().toLowerCase();if(e.length>254||!/^[^\s@]+@[^\s@]+$/.test(e))return null;
 const dom=e.split('@')[1];
 for(const r of rules){if(r.type==='domain'?r.value===dom:compileEmailRegex(r.value).matches(e))return r;}
 return null;
}
export const schoolCode=z.string().regex(/^[a-z0-9-]{2,40}$/);
const campus=z.object({name:z.string().trim().min(1).max(120),address:z.string().trim().max(300),latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180)}).strict();
const limits=z.object({maxCarpoolStudents:z.number().int().min(1).max(12),maxHomesPerUser:z.number().int().min(1).max(50),maxUsersPerEduEmail:z.number().int().min(1).max(20)}).strict();
/** School-admin editable settings. schoolCode and centralUrl are pinned at claim time and immutable here. */
export const settingsPatch=z.object({
 officialName:z.string().trim().min(2).max(120),
 publicUrl:origin,
 corsOrigins:z.array(origin).max(20).transform(d=>[...new Set(d)]),
 campus, emailRules, limits,
 mailer:z.object({provider:z.enum(['smtp','google','gmail','appsscript','appsscript_push','test']),appsscriptMode:z.enum(['relay','token']),smtpHost:z.string().trim().min(1).max(253).regex(/^[A-Za-z0-9.-]+$/),smtpPort:z.number().int().min(1).max(65535),smtpSecure:z.boolean(),smtpSecurity:z.enum(['starttls','tls','none']),smtpFrom:z.string().trim().email().max(254),smtpUser:secret,smtpPassword:secret.nullable(),fromEmail:z.string().trim().email().max(254),url:appsScriptUrl,secret:secret.nullable(),gmailUser:z.string().trim().email().max(254),fromName:z.string().trim().max(80),clientId:secret,clientSecret:secret.nullable(),refreshToken:secret.nullable()}).partial().strict(),
}).partial().strict();
export type Mailer={provider:'smtp'|'google'|'gmail'|'appsscript'|'appsscript_push'|'test';appsscriptMode?:'relay'|'token';smtpHost?:string;smtpPort?:number;smtpSecure?:boolean;smtpSecurity?:'starttls'|'tls'|'none';smtpFrom?:string;smtpUser?:string;smtpPassword?:string;fromEmail?:string;url?:string;secret?:string;gmailUser?:string;fromName:string;clientId?:string;clientSecret?:string;refreshToken?:string};
export type SchoolSettings={configured:boolean;schoolCode?:string;centralUrl?:string;officialName:string;publicUrl?:string;corsOrigins:string[];campus:z.infer<typeof campus>;emailRules:z.infer<typeof emailRules>;limits:z.infer<typeof limits>;mailer:Mailer};
export type Configured=SchoolSettings&{configured:true;schoolCode:string;centralUrl:string};
const BLANK:SchoolSettings={configured:false,officialName:'Unconfigured school',corsOrigins:[],campus:{name:'Campus',address:'',latitude:0,longitude:0},emailRules:[],limits:{maxCarpoolStudents:4,maxHomesPerUser:3,maxUsersPerEduEmail:1},mailer:{provider:'gmail',fromName:'Carpschool'}};
/** All school configuration lives in the settings collection under key "school". Env holds only PORT/NODE_ENV/MONGO_URI. */
@Injectable()
export class SettingsService {
 cache?:{at:number;value:SchoolSettings};
 constructor(readonly db:Database){}
 async get():Promise<SchoolSettings>{
  if(this.cache&&Date.now()-this.cache.at<5000)return this.cache.value;
  const v=(await this.db.settings.findOne({key:'school'}).lean<any>())?.value||{};
  const value:SchoolSettings={...BLANK,...v,campus:{...BLANK.campus,...v.campus},emailRules:v.emailRules??(v.email?.domains||[]).map((d:string)=>({type:'domain',value:d})),limits:{...BLANK.limits,...v.limits},mailer:{...BLANK.mailer,...v.mailer},configured:!!(v.configured&&v.schoolCode&&v.centralUrl)};
  this.cache={at:Date.now(),value};return value;
 }
 /** Throws 503 until the school has been claimed. */
 async ready():Promise<Configured>{const s=await this.get();if(!s.configured)throw new ServiceUnavailableException('School server not set up yet');return s as Configured;}
 async emailAllowed(email:string){return !!ruleMatches((await this.get()).emailRules,email);}
 /** Plain domain rules only (regex rules are never published). */
 async domains(){return (await this.get()).emailRules.filter(r=>r.type==='domain').map(r=>r.value);}
 /** Safe view: mailer secrets are write-only. */
 async view(){const s=await this.get();const {clientSecret,refreshToken,secret,smtpPassword,...m}=s.mailer;return {...s,mailer:{...m,smtpFrom:m.smtpFrom??m.fromEmail,smtpSecurity:m.smtpSecurity??(m.smtpSecure?'tls':'starttls'),clientSecretSet:!!clientSecret,refreshTokenSet:!!refreshToken,secretSet:!!secret,smtpPasswordSet:!!smtpPassword,configured:m.provider==='test'||(m.provider==='google'?!!await this.db.mailerStates.exists({key:'google',refreshToken:{$exists:true}}):m.provider==='smtp'?!!(m.smtpHost&&m.smtpPort&&m.smtpUser&&smtpPassword&&(m.smtpFrom||m.fromEmail)):(m.provider==='appsscript'||m.provider==='appsscript_push')?((m.provider==='appsscript_push'||m.appsscriptMode==='token')?!!(m.gmailUser&&await this.db.mailerStates.exists({key:'appsscript',token:{$exists:true},expiresAt:{$gt:new Date(Date.now()+30000)}})):!!(m.url&&validAppsScriptUrl(m.url)&&secret)):!!(m.gmailUser&&m.clientId&&clientSecret&&refreshToken))}};}
 async write(next:any){await this.db.settings.updateOne({key:'school'},{$set:{value:next}},{upsert:true});this.cache=undefined;}
 async update(patch:{[K in keyof z.output<typeof settingsPatch>]?:any}){
  const cur=(await this.db.settings.findOne({key:'school'}).lean<any>())?.value||{};const next:any={...cur};
  for(const k of ['officialName','publicUrl','corsOrigins','campus','emailRules','limits'] as const)if(patch[k]!==undefined)next[k]=patch[k];
  if(patch.mailer){
   if(patch.mailer.provider==='test'&&loadConfig().NODE_ENV==='production')throw new BadRequestException('Test mailer is not allowed in production');
   const m={...(cur.mailer||{})};for(const [k,val] of Object.entries(patch.mailer)){if(val===null)delete m[k];else m[k]=val;}if((m.provider==='appsscript_push'||(m.provider==='appsscript'&&m.appsscriptMode==='token'))&&!m.gmailUser)throw new BadRequestException('Set the Apps Script sending account address before switching');if((m.provider==='appsscript_push'||(m.provider==='appsscript'&&m.appsscriptMode==='token'))&&!await this.db.mailerStates.exists({key:'appsscript',token:{$exists:true},expiresAt:{$gt:new Date(Date.now()+30000)}}))throw new BadRequestException('Confirm a valid Apps Script token before switching');if(m.provider==='google'&&!await this.db.mailerStates.exists({key:'google',refreshToken:{$exists:true}}))throw new BadRequestException('Connect Google before selecting this mailer');next.mailer=m;
  }
  await this.write(next);return this.view();
 }
 /** Called once by the setup claim. */
 async claim(v:{schoolCode:string;centralUrl:string;publicUrl:string;name?:string}){
  const cur=(await this.db.settings.findOne({key:'school'}).lean<any>())?.value||{};
  await this.write({...cur,configured:true,schoolCode:v.schoolCode,centralUrl:v.centralUrl,publicUrl:v.publicUrl,...(v.name?{officialName:v.name}:{})});
 }
}
