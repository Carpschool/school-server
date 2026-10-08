import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';
import { createHash } from 'node:crypto';
import { SettingsService, validAppsScriptUrl } from './settings.js';
@Injectable()
export class Mailer {
 transport?:{key:string;t:Transporter};
 readonly logger=new Logger(Mailer.name);
 readonly testMessages:{to:string;subject:string;text:string}[]=[];
 constructor(readonly settings:SettingsService){}
 async send(to:string,subject:string,text:string,html?:string){
  const m=(await this.settings.get()).mailer;
  if(m.provider==='test'){this.testMessages.push({to,subject,text,...(html?{html}:{})});return;}
  if(m.provider==='appsscript'){
   if(!m.url||!validAppsScriptUrl(m.url)||!m.secret)throw new ServiceUnavailableException('Mailer not configured');
   // Google ContentService redirects the response to googleusercontent.com.
   // Native fetch follows that redirect, changing POST to GET without resending the secret.
   try{
    const response=await fetch(m.url,{method:'POST',redirect:'follow',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:m.secret,to,subject,text,html:html??''}),signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error('HTTP failure');
    const result:unknown=await response.json();
    if(!result||typeof result!=='object'||!('ok' in result)||result.ok!==true)throw new Error('Relay rejected message');
   }catch{
    // Never surface the relay body, fetch error, deployment URL, or shared secret.
    // No retries: a timeout may happen after delivery, and retrying would duplicate mail.
    throw new ServiceUnavailableException('Email delivery failed. Try again later.');
   }
   return;
  }
  if(!m.gmailUser||!m.clientId||!m.clientSecret||!m.refreshToken)throw new Error('Mailer not configured');
  const key=createHash('sha256').update(JSON.stringify([m.gmailUser,m.clientId,m.clientSecret,m.refreshToken])).digest('hex');
  if(this.transport?.key!==key){this.transport?.t.close();this.transport={key,t:createTransport({service:'gmail',auth:{type:'OAuth2',user:m.gmailUser,clientId:m.clientId,clientSecret:m.clientSecret,refreshToken:m.refreshToken},disableFileAccess:true,disableUrlAccess:true})};}
  const name=m.fromName.replace(/["\r\n<>]/g,'');
  await this.transport.t.sendMail({from:name?{name,address:m.gmailUser}:m.gmailUser,to,subject,text,...(html?{html}:{})});
 }
 async notify(to:string,subject:string,text:string){try{await this.send(to,subject,text);}catch{this.logger.error('Ride notification delivery failed');}}
}
