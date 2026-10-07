import { Injectable, Logger } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';
import { loadConfig } from './config.js';
@Injectable()
export class Mailer {
 transport?:Transporter;
 readonly logger=new Logger(Mailer.name);
 readonly testMessages:{to:string;subject:string;text:string}[]=[];
 constructor(){const c=loadConfig();if(c.EMAIL_PROVIDER==='gmail')this.transport=createTransport({service:'gmail',auth:{type:'OAuth2',user:c.GMAIL_USER,clientId:c.GMAIL_OAUTH_CLIENT_ID,clientSecret:c.GMAIL_OAUTH_CLIENT_SECRET,refreshToken:c.GMAIL_OAUTH_REFRESH_TOKEN},disableFileAccess:true,disableUrlAccess:true});}
 async send(to:string,subject:string,text:string){if(!this.transport){this.testMessages.push({to,subject,text});return;}await this.transport.sendMail({from:loadConfig().GMAIL_USER,to,subject,text});}
 async notify(to:string,subject:string,text:string){try{await this.send(to,subject,text);}catch{this.logger.error('Ride notification delivery failed');}}
}
