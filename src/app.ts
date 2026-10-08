import 'reflect-metadata';
import {GoogleMailer,GoogleMailerController} from './google-mailer.js';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { Database } from './database.js';
import { Auth, AuthGuard } from './security.js';
import { AppsScriptTokens } from './appsscript.js';
import { Mailer } from './mailer.js';
import { SettingsService } from './settings.js';
import { SchoolService } from './school.service.js';
import { SetupService } from './setup.js';
import { ChatGateway } from './gateway.js';
import { PublicController,ProfileController,RideController,NegotiationController,CarpoolController,SafetyController,AdminController,MailerTokenController } from './controllers.js';
@Module({imports:[ThrottlerModule.forRoot([{ttl:60000,limit:120}])],controllers:[GoogleMailerController,PublicController,ProfileController,RideController,NegotiationController,CarpoolController,SafetyController,AdminController,MailerTokenController],providers:[Database,SettingsService,SetupService,Auth,AppsScriptTokens,GoogleMailer,Mailer,SchoolService,ChatGateway,{provide:APP_GUARD,useClass:AuthGuard},{provide:APP_GUARD,useClass:ThrottlerGuard}]})
export class AppModule{}
