import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { Database } from './database.js';
import { Auth, AuthGuard } from './security.js';
import { Mailer } from './mailer.js';
import { SettingsService } from './settings.js';
import { SchoolService } from './school.service.js';
import { SetupService } from './setup.js';
import { ChatGateway } from './gateway.js';
import { PublicController,ProfileController,RideController,NegotiationController,CarpoolController,SafetyController,AdminController } from './controllers.js';
@Module({imports:[ThrottlerModule.forRoot([{ttl:60000,limit:120}])],controllers:[PublicController,ProfileController,RideController,NegotiationController,CarpoolController,SafetyController,AdminController],providers:[Database,SettingsService,SetupService,Auth,Mailer,SchoolService,ChatGateway,{provide:APP_GUARD,useClass:AuthGuard},{provide:APP_GUARD,useClass:ThrottlerGuard}]})
export class AppModule{}
