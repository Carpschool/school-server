import { Injectable, Logger } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';
import { createHash } from 'node:crypto';
import { SettingsService } from './settings.js';
@Injectable()
export class Mailer {
 transport?:{key:string;t:Transporter};
 readonly logger=new Logger(Mailer.name);
 readonly testMessages:{to:string;subject:string;text:string}[]=[];
 constructor(readonly settings:SettingsService){}
 async send(to:string,subject:string,text:string){
  const m=(await this.settings.get()).mailer;
  if(m.provider==='test'){this.testMessages.push({to,subject,text});return;}
  if(!m.gmailUser||!m.clientId||!m.clientSecret||!m.refreshToken)throw new Error('Mailer not configured');
  const key=createHash('sha256').update(JSON.stringify([m.gmailUser,m.clientId,m.clientSecret,m.refreshToken])).digest('hex');
  if(this.transport?.key!==key){this.transport?.t.close();this.transport={key,t:createTransport({service:'gmail',auth:{type:'OAuth2',user:m.gmailUser,clientId:m.clientId,clientSecret:m.clientSecret,refreshToken:m.refreshToken},disableFileAccess:true,disableUrlAccess:true})};}
  const name=m.fromName.replace(/["\r\n<>]/g,'');
  await this.transport.t.sendMail({from:name?{name,address:m.gmailUser}:m.gmailUser,to,subject,text});
 }
 async notify(to:string,subject:string,text:string){try{await this.send(to,subject,text);}catch{this.logger.error('Ride notification delivery failed');}}
}
