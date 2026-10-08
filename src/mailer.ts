import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';
import { createHash } from 'node:crypto';
import { AppsScriptTokens } from './appsscript.js';
import { SettingsService, validAppsScriptUrl } from './settings.js';
@Injectable()
export class Mailer {
 transport?:{key:string;t:Transporter};
 readonly logger=new Logger(Mailer.name);
 readonly testMessages:{to:string;subject:string;text:string}[]=[];
 constructor(readonly settings:SettingsService,readonly tokens?:AppsScriptTokens){}
 async send(to:string,subject:string,text:string,html?:string){
  const m=(await this.settings.get()).mailer;
  if(m.provider==='test'){this.testMessages.push({to,subject,text,...(html?{html}:{})});return;}
  if(m.provider==='appsscript'&&m.appsscriptMode!=='token'){
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
  try{
   const name=m.fromName.replace(/["\r\n<>]/g,'');
   const from=m.provider==='smtp'?m.fromEmail:m.gmailUser;
   if(!from||/[\r\n]/.test(from)||!/^([^\s@]+)@([^\s@]+)$/.test(to)||/[\r\n]/.test(subject))throw new Error('Invalid message');
   const message={from:{name,address:from},to,subject,text,...(html?{html}:{})};
   if(m.provider==='smtp'){
    if(!m.smtpHost||!m.smtpPort||!m.smtpUser||!m.smtpPassword)throw new Error('Missing SMTP configuration');
    const key=createHash('sha256').update(JSON.stringify([m.smtpHost,m.smtpPort,m.smtpSecure,m.smtpUser,m.smtpPassword])).digest('hex');
    if(this.transport?.key!==key){this.transport?.t.close();this.transport={key,t:createTransport({host:m.smtpHost,port:m.smtpPort,secure:m.smtpSecure===true,requireTLS:m.smtpSecure!==true,auth:{user:m.smtpUser,pass:m.smtpPassword},connectionTimeout:15000,greetingTimeout:15000,socketTimeout:15000,disableFileAccess:true,disableUrlAccess:true})};}
    await this.transport.t.sendMail(message);return;
   }
   let token:string;
   if(m.provider==='appsscript_push'||(m.provider==='appsscript'&&m.appsscriptMode==='token')){
    if(!this.tokens)throw new Error('Token service unavailable');token=await this.tokens.accessToken();
   }else{
    if(!m.clientId||!m.clientSecret||!m.refreshToken)throw new Error('Missing Google configuration');
    const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',redirect:'error',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:m.clientId,client_secret:m.clientSecret,refresh_token:m.refreshToken}),signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error('Refresh failed');const data=await response.json() as any;
    if(typeof data.access_token!=='string'||!/^[\x21-\x7e]{10,10000}$/.test(data.access_token))throw new Error('Invalid token');
    token=data.access_token;
   }
   // Nodemailer composes MIME, does not deliver or fetch external content.
   const composer=createTransport({streamTransport:true,buffer:true,disableFileAccess:true,disableUrlAccess:true});
   const mail=await composer.sendMail(message);const raw=Buffer.from(mail.message as Buffer).toString('base64url');
   const sent=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({raw}),signal:AbortSignal.timeout(15000)});
   if(!sent.ok)throw new Error('Send failed');const result=await sent.json() as any;if(typeof result.id!=='string'||!result.id)throw new Error('Invalid send response');
  }catch{throw new ServiceUnavailableException('Email delivery failed. Try again later.');}
 }
 async notify(to:string,subject:string,text:string){try{await this.send(to,subject,text);}catch{this.logger.error('Ride notification delivery failed');}}
}
