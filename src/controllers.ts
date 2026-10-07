import { Controller, Get, Post, Put, Delete, Body, Req, Param, Query, NotFoundException, BadRequestException } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiTags } from '@nestjs/swagger';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { z } from 'zod';
import { sign } from 'node:crypto';
import { Public, Admin, Auth, SetupOpen } from './security.js';
import { Database } from './database.js';
import { SchoolService } from './school.service.js';
import { schoolKey, schoolPublicKey } from './config.js';
import { settingsPatch, emailRules, ruleMatches } from './settings.js';
import { SetupService, claimDto } from './setup.js';
import { parse, objectId, geo, commute, coordinates, proposalSchema } from './validation.js';
const dto=(schema:z.ZodTypeAny)=>ApiBody({schema:zodToJsonSchema(schema,{$refStrategy:'none'}) as any});
const sessionDto=z.object({ticket:z.string().min(20).max(16000)}).strict();
const otpSend=z.object({email:z.string().email().max(254)}).strict();
const otpVerify=z.object({code:z.string().regex(/^\d{6}$/)}).strict();
const profile=z.discriminatedUnion('role',[
 z.object({role:z.literal('rider'),name:z.string().min(1).max(100),phone:z.string().min(7).max(25)}).strict(),
 z.object({role:z.literal('driver'),name:z.string().min(1).max(100),phone:z.string().min(7).max(25),personalEmail:z.string().email(),car:z.object({make:z.string().min(1).max(60),color:z.string().min(1).max(30),plate:z.string().min(1).max(20)}).strict(),licenseConfirmed:z.literal(true)}).strict()
]);
const home=z.object({label:z.string().min(1).max(80),location:geo,walkingRadius:z.number().min(10).max(200)}).strict();
const drive=z.object({commute,route:z.array(coordinates).min(2).max(1000),seats:z.number().int().min(1).max(12)}).strict();
const message=z.object({text:z.string().min(1).max(2000)}).strict();
const rider=z.object({rider:z.string().min(1).max(128)}).strict();
const board=z.object({rider:z.string().min(1).max(128),pin:z.string().regex(/^\d{4}$/),location:geo}).strict();
const dropoff=z.object({rider:z.string().min(1).max(128),location:geo}).strict();
const report=z.object({subject:z.string().min(1).max(128),reason:z.string().min(5).max(2000)}).strict();
@ApiTags('public')
@Controller()
export class PublicController {
 constructor(readonly auth:Auth,readonly service:SchoolService,readonly setup:SetupService){}
 @Public() @SetupOpen() @Get('health') async health(){const s=await this.service.settings.get();return {status:'ok',configured:s.configured,schoolCode:s.schoolCode??null};}
 /** First-run claim from a central admin (see setup.ts). Only works while unconfigured. */
 @Public() @SetupOpen() @Post('setup/claim') @dto(claimDto) claim(@Body() b:unknown){return this.setup.claim(parse(claimDto,b));}
 @Public() @Get('.well-known/carpschool.json') async metadata(){const s=await this.service.settings.ready();return {schoolCode:s.schoolCode,name:s.officialName,domains:s.emailRules.filter(r=>r.type==='domain').map(r=>r.value),baseUrl:s.publicUrl,publicKey:schoolPublicKey(),campus:{name:s.campus.name,address:s.campus.address,coordinates:[s.campus.longitude,s.campus.latitude]},limits:{homes:s.limits.maxHomesPerUser,seats:s.limits.maxCarpoolStudents}};}
 @Public() @Get('federation/challenge') challenge(@Query('nonce') nonce:string){parse(z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),nonce);return {signature:sign(null,Buffer.from(nonce),schoolKey()).toString('base64url')};}
 @Public() @Post('sessions') @dto(sessionDto) exchange(@Body() b:unknown){return this.auth.exchange(parse(sessionDto,b).ticket);}
}
@ApiTags('onboarding') @ApiBearerAuth() @Controller()
export class ProfileController {
 constructor(readonly service:SchoolService,readonly db:Database){}
 @Get('me') async me(@Req() r:any){return this.db.users.findOne({sub:r.identity.sub}).lean<any>();}
 @Post('edu/send') @dto(otpSend) send(@Req() r:any,@Body() b:unknown){return this.service.sendOtp(r.identity.sub,parse(otpSend,b).email,r.ip);}
 @Post('edu/verify') @dto(otpVerify) verify(@Req() r:any,@Body() b:unknown){return this.service.verifyOtp(r.identity.sub,parse(otpVerify,b).code);}
 @Post('profile') @dto(profile) profile(@Req() r:any,@Body() b:unknown){return this.service.profile(r.identity.sub,parse(profile,b));}
 @Get('homes') async homes(@Req() r:any){await this.service.ready(r.identity.sub);return this.db.homes.find({owner:r.identity.sub}).lean<any>();}
 @Post('homes') @dto(home) add(@Req() r:any,@Body() b:unknown){return this.service.addHome(r.identity.sub,parse(home,b));}
 @Put('homes/:id') @dto(home) async update(@Req() r:any,@Param('id') id:string,@Body() b:unknown){await this.service.ready(r.identity.sub);const h=await this.db.homes.findOneAndUpdate({_id:objectId(id),owner:r.identity.sub},{$set:parse(home,b)},{new:true}).lean<any>();if(!h)throw new NotFoundException();return h;}
 @Delete('homes/:id') delete(@Req() r:any,@Param('id') id:string){return this.service.deleteHome(r.identity.sub,id);}
}
@ApiTags('rides') @ApiBearerAuth() @Controller()
export class RideController {
 constructor(readonly service:SchoolService,readonly db:Database){}
 @Get('requests') async requests(@Req() r:any){await this.service.ready(r.identity.sub,'rider');return this.db.requests.find({owner:r.identity.sub}).sort({createdAt:-1}).limit(100).lean<any>();}
 @Post('requests') @dto(commute) request(@Req() r:any,@Body() b:unknown){return this.service.createRequest(r.identity.sub,parse(commute,b));}
 @Get('requests/:id') async getRequest(@Req() r:any,@Param('id') id:string){await this.service.ready(r.identity.sub);return this.service.owner(this.db.requests,id,r.identity.sub);}
 @Delete('requests/:id') async cancelRequest(@Req() r:any,@Param('id') id:string){await this.service.ready(r.identity.sub,'rider');const v=await this.db.requests.findOneAndUpdate({_id:objectId(id),owner:r.identity.sub,status:'active'},{$set:{status:'cancelled'}},{new:true}).lean<any>();if(!v)throw new NotFoundException();return v;}
 @Get('drives') async drives(@Req() r:any){await this.service.ready(r.identity.sub,'driver');return this.db.drives.find({owner:r.identity.sub}).sort({createdAt:-1}).limit(100).lean<any>();}
 @Post('drives') @dto(drive) async drive(@Req() r:any,@Body() b:unknown){const v=parse(drive,b);if(v.seats>(await this.service.settings.get()).limits.maxCarpoolStudents)throw new BadRequestException('School seat limit exceeded');return this.service.createDrive(r.identity.sub,{...v.commute,route:v.route,seats:v.seats});}
 @Get('drives/:id') async getDrive(@Req() r:any,@Param('id') id:string){await this.service.ready(r.identity.sub);return this.service.owner(this.db.drives,id,r.identity.sub);}
 @Delete('drives/:id') cancelDrive(@Req() r:any,@Param('id') id:string){return this.service.cancelDrive(r.identity.sub,id);}
 @Get('drives/:id/matches') matches(@Req() r:any,@Param('id') id:string){return this.service.matches(r.identity.sub,id);}
 @Post('drives/:id/negotiations') @dto(z.object({requestId:z.string().regex(/^[a-f0-9]{24}$/)}).strict()) reach(@Req() r:any,@Param('id') id:string,@Body() b:unknown){const v=parse(z.object({requestId:z.string().regex(/^[a-f0-9]{24}$/)}).strict(),b);return this.service.reachOut(r.identity.sub,id,v.requestId);}
 @Get('matches') async riderMatches(@Req() r:any){await this.service.ready(r.identity.sub,'rider');const ns=await this.db.negotiations.find({rider:r.identity.sub,status:'open'}).lean<any>();return ns.map((n:any)=>({negotiationId:String(n._id),driveId:n.driveId,requestId:n.requestId,driver:n.driver}));}
}
@ApiTags('negotiations') @ApiBearerAuth() @Controller('negotiations')
export class NegotiationController {
 constructor(readonly service:SchoolService,readonly db:Database){}
 @Get() async list(@Req() r:any){await this.service.ready(r.identity.sub);return this.db.negotiations.find({$or:[{driver:r.identity.sub},{rider:r.identity.sub}]}).limit(100).lean<any>();}
 @Get(':id') get(@Req() r:any,@Param('id') id:string){return this.service.participant(r.identity.sub,id);}
 @Get(':id/messages') async messages(@Req() r:any,@Param('id') id:string){await this.service.participant(r.identity.sub,id);return this.db.messages.find({negotiationId:id}).sort({createdAt:1}).limit(200).lean<any>();}
 @Post(':id/messages') @dto(message) message(@Req() r:any,@Param('id') id:string,@Body() b:unknown){return this.service.message(r.identity.sub,id,parse(message,b).text);}
 @Get(':id/proposals') async proposals(@Req() r:any,@Param('id') id:string){await this.service.participant(r.identity.sub,id);return this.db.proposals.find({negotiationId:id}).sort({createdAt:-1}).limit(100).lean<any>();}
 @Post(':id/proposals') @dto(proposalSchema) propose(@Req() r:any,@Param('id') id:string,@Body() b:unknown){return this.service.propose(r.identity.sub,id,parse(proposalSchema,b));}
 @Post(':id/proposals/:proposalId/accept') accept(@Req() r:any,@Param('id') id:string,@Param('proposalId') p:string){return this.service.accept(r.identity.sub,id,p);}
}
@ApiTags('carpools') @ApiBearerAuth() @Controller('carpools')
export class CarpoolController {
 constructor(readonly service:SchoolService,readonly db:Database){}
 @Get() async list(@Req() r:any){await this.service.ready(r.identity.sub);return this.db.drives.find({$or:[{owner:r.identity.sub},{'passengers.rider':r.identity.sub}]}).select('-route').limit(100).lean<any>().then((ds:any[])=>ds.map((d:any)=>({...d,passengers:d.owner===r.identity.sub?d.passengers:d.passengers.filter((p:any)=>p.rider===r.identity.sub)})));}
 @Get(':id') get(@Req() r:any,@Param('id') id:string){return this.service.carpool(r.identity.sub,id);}
 @Post(':id/pin') pin(@Req() r:any,@Param('id') id:string){return this.service.pin(r.identity.sub,id);}
 @Post(':id/board') @dto(board) async board(@Req() r:any,@Param('id') id:string,@Body() b:unknown){const v=parse(board,b);const result=await this.service.board(r.identity.sub,id,v.rider,v.pin,v.location);if('invalid' in result)throw new BadRequestException('Invalid PIN');return result;}
 @Post(':id/dropoff') @dto(dropoff) dropoff(@Req() r:any,@Param('id') id:string,@Body() b:unknown){const v=parse(dropoff,b);return this.service.dropoff(r.identity.sub,id,v.rider,v.location);}
 @Post(':id/leave') @dto(rider) leave(@Req() r:any,@Param('id') id:string,@Body() b:unknown){return this.service.leave(r.identity.sub,id,parse(rider,b).rider);}
 @Get(':id/events') async events(@Req() r:any,@Param('id') id:string){const d=await this.service.carpool(r.identity.sub,id);return this.db.events.find({driveId:id,...(d.owner===r.identity.sub?{}:{rider:r.identity.sub})}).lean<any>();}
}
@ApiTags('safety') @ApiBearerAuth() @Controller()
export class SafetyController {
 constructor(readonly service:SchoolService,readonly db:Database){}
 @Post('reports') @dto(report) async report(@Req() r:any,@Body() b:unknown){await this.service.ready(r.identity.sub);const v=parse(report,b);if(!await this.db.users.exists({sub:v.subject}))throw new NotFoundException();return this.db.reports.create({reporter:r.identity.sub,...v});}
 @Get('blocks') async blocks(@Req() r:any){await this.service.ready(r.identity.sub);return this.db.blocks.find({owner:r.identity.sub}).lean<any>();}
 @Post('blocks') @dto(z.object({subject:z.string().min(1).max(128)}).strict()) async block(@Req() r:any,@Body() b:unknown){await this.service.ready(r.identity.sub);const v=parse(z.object({subject:z.string().min(1).max(128)}).strict(),b);if(v.subject===r.identity.sub)throw new BadRequestException('Cannot block yourself');return this.db.blocks.findOneAndUpdate({owner:r.identity.sub,subject:v.subject},{$setOnInsert:{owner:r.identity.sub,subject:v.subject}},{upsert:true,new:true}).lean<any>();}
 @Delete('blocks/:subject') async unblock(@Req() r:any,@Param('subject') subject:string){await this.service.ready(r.identity.sub);parse(z.string().min(1).max(128),subject);await this.db.blocks.deleteOne({owner:r.identity.sub,subject});return {deleted:true};}
}
@ApiTags('admin') @ApiBearerAuth() @Admin() @Controller('admin')
export class AdminController {
 constructor(readonly db:Database,readonly service:SchoolService){}
 @Get('users') users(){return this.db.users.find().sort({createdAt:-1}).limit(100).lean<any>();}
 @Put('users/:id/ban') @dto(z.object({banned:z.boolean()}).strict()) async ban(@Param('id') id:string,@Body() b:unknown){const u=await this.db.users.findOneAndUpdate({_id:objectId(id)},{$set:parse(z.object({banned:z.boolean()}).strict(),b)},{new:true}).lean<any>();if(!u)throw new NotFoundException();return u;}
 @Get('reports') reports(){return this.db.reports.find().sort({createdAt:-1}).limit(100).lean<any>();}
 @Put('reports/:id') @dto(z.object({status:z.enum(['open','resolved','dismissed'])}).strict()) async resolve(@Param('id') id:string,@Body() b:unknown){const v=await this.db.reports.findOneAndUpdate({_id:objectId(id)},{$set:parse(z.object({status:z.enum(['open','resolved','dismissed'])}).strict(),b)},{new:true}).lean<any>();if(!v)throw new NotFoundException();return v;}
 @Get('email-rules') async rules(){return (await this.service.settings.get()).emailRules;}
 @Put('email-rules') @dto(emailRules) async rulesSet(@Body() b:unknown){return (await this.service.settings.update({emailRules:parse(emailRules,b)})).emailRules;}
 /** Live test box: validates unsaved rules and tests one email with the exact server matcher (RE2). */
 @Post('email-rules/test') async rulesTest(@Body() b:unknown){const v=parse(z.object({email:z.string().max(254),rules:emailRules}).strict(),b);const m=ruleMatches(v.rules,v.email);return {allowed:!!m,matched:m};}
 @Get('mailer') async mailer(){return (await this.service.settings.view()).mailer;}
 @Get('settings') settingsGet(){return this.service.settings.view();}
 @Put('settings') @dto(settingsPatch) settingsPut(@Body() b:unknown){return this.service.settings.update(parse(settingsPatch,b));}
}
