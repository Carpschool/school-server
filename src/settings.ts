import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Database } from './database.js';
import { loadConfig } from './config.js';
const domain=z.string().trim().toLowerCase().regex(/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/);
const secret=z.string().trim().min(1).max(2048);
export const settingsPatch=z.object({
 officialName:z.string().trim().min(2).max(120),
 campus:z.object({name:z.string().trim().min(1).max(120),address:z.string().trim().max(300),latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180)}).strict(),
 domains:z.array(domain).min(1).max(30).transform(d=>[...new Set(d)]),
 limits:z.object({maxCarpoolStudents:z.number().int().min(1).max(12),maxHomesPerUser:z.number().int().min(1).max(50),maxUsersPerEduEmail:z.number().int().min(1).max(20)}).strict(),
 mailer:z.object({gmailUser:z.string().trim().email().max(254),fromName:z.string().trim().max(80),clientId:secret,clientSecret:secret.nullable(),refreshToken:secret.nullable()}).partial().strict(),
}).partial().strict();
export type SchoolSettings={officialName:string;campus:{name:string;address:string;latitude:number;longitude:number};domains:string[];limits:{maxCarpoolStudents:number;maxHomesPerUser:number;maxUsersPerEduEmail:number};mailer:{provider:string;gmailUser?:string;fromName:string;clientId?:string;clientSecret?:string;refreshToken?:string}};
function defaults():SchoolSettings{const c=loadConfig();return {officialName:c.OFFICIAL_NAME,campus:{name:c.OFFICIAL_NAME,address:'',latitude:c.CAMPUS_LATITUDE,longitude:c.CAMPUS_LONGITUDE},domains:c.ALLOWED_EMAIL_DOMAINS.split(',').map(d=>d.trim().toLowerCase()).filter(Boolean),limits:{maxCarpoolStudents:c.MAX_CARPOOL_STUDENTS,maxHomesPerUser:c.MAX_HOMES_PER_USER,maxUsersPerEduEmail:c.MAX_USERS_PER_EDU_EMAIL},mailer:{provider:c.EMAIL_PROVIDER,gmailUser:c.GMAIL_USER,fromName:'Carpschool',clientId:c.GMAIL_OAUTH_CLIENT_ID,clientSecret:c.GMAIL_OAUTH_CLIENT_SECRET,refreshToken:c.GMAIL_OAUTH_REFRESH_TOKEN}};}
/** School settings: env supplies initial defaults only, the DB document (key "school") overrides them. */
@Injectable()
export class SettingsService {
 cache?:{at:number;value:SchoolSettings};
 constructor(readonly db:Database){}
 async get():Promise<SchoolSettings>{
  if(this.cache&&Date.now()-this.cache.at<5000)return this.cache.value;
  const d=defaults();const [doc,legacy]=await Promise.all([this.db.settings.findOne({key:'school'}).lean<any>(),this.db.settings.findOne({key:'domains'}).lean<any>()]);const v=doc?.value||{};
  const value:SchoolSettings={officialName:v.officialName??d.officialName,campus:{...d.campus,...v.campus},domains:v.domains??legacy?.value??d.domains,limits:{...d.limits,...v.limits},mailer:{...d.mailer,...v.mailer,provider:d.mailer.provider}};
  this.cache={at:Date.now(),value};return value;
 }
 /** Safe view for admins: secrets are write-only. */
 async view(){const s=await this.get();const {clientSecret,refreshToken,...m}=s.mailer;return {...s,mailer:{...m,clientSecretSet:!!clientSecret,refreshTokenSet:!!refreshToken,configured:!!(m.gmailUser&&m.clientId&&clientSecret&&refreshToken)}};}
 async update(patch:z.infer<typeof settingsPatch>){
  const doc=await this.db.settings.findOne({key:'school'}).lean<any>();const cur=doc?.value||{};const next:any={...cur};
  if(patch.officialName!==undefined)next.officialName=patch.officialName;
  if(patch.campus)next.campus=patch.campus;
  if(patch.domains)next.domains=patch.domains;
  if(patch.limits)next.limits=patch.limits;
  if(patch.mailer){const m={...(cur.mailer||{})};for(const [k,val] of Object.entries(patch.mailer)){if(val===null)delete m[k];else m[k]=val;}next.mailer=m;}
  await this.db.settings.updateOne({key:'school'},{$set:{value:next}},{upsert:true});
  if(patch.domains)await this.db.settings.deleteOne({key:'domains'});
  this.cache=undefined;return this.view();
 }
}
