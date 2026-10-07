import { Injectable, BadRequestException, ForbiddenException, NotFoundException, ConflictException, HttpException } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { buffer } from '@turf/buffer';
import pointToLineDistance from '@turf/point-to-line-distance';
import { lineString, point } from '@turf/helpers';
import { Database } from './database.js';
import { Mailer } from './mailer.js';
import { loadConfig } from './config.js';
import { hashCode, compareCode } from './security.js';
import { objectId } from './validation.js';
@Injectable()
export class SchoolService {
 constructor(readonly db:Database,readonly mailer:Mailer){}
 async transaction<T>(fn:(session:any)=>Promise<T>):Promise<T>{const session=await this.db.connection.startSession();try{return await session.withTransaction(()=>fn(session)) as T;}finally{await session.endSession();}}
 async ready(sub:string,role?:string){const u=await this.db.users.findOne({sub}).lean<any>();if(!u||!u.verified||u.banned)throw new ForbiddenException('Verify your school email first');if(role&&u.role!==role)throw new ForbiddenException(role+' role required');return u;}
 async owner(model:any,id:string,sub:string){const doc=await model.findOne({_id:objectId(id),owner:sub}).lean();if(!doc)throw new NotFoundException();return doc;}
 async limit(key:string,max:number,seconds:number){const bucket=Math.floor(Date.now()/(seconds*1000));const r=await this.db.limits.findOneAndUpdate({key:key+':'+bucket},{$inc:{count:1},$setOnInsert:{expiresAt:new Date((bucket+2)*seconds*1000)}},{upsert:true,new:true});if(r.count>max)throw new HttpException('Try again later',429);}
 async domains(){const setting=await this.db.settings.findOne({key:'domains'}).lean<any>();return setting?.value??loadConfig().ALLOWED_EMAIL_DOMAINS.split(',').map(d=>d.trim().toLowerCase());}
 async sendOtp(sub:string,email:string,ip:string){
  const u=await this.db.users.findOne({sub}).lean<any>();if(u?.verified)throw new ConflictException('School email already verified');
  email=email.trim().toLowerCase();const domain=email.split('@')[1];if(!(await this.domains()).includes(domain))throw new BadRequestException('School email domain not allowed');
  await this.limit('otp-ip:'+ip,10,3600);await this.limit('otp-sub:'+sub,5,3600);await this.limit('otp-email:'+email,5,3600);await this.limit('otp-cooldown:'+sub,1,60);
  const code=randomInt(0,1000000).toString().padStart(6,'0');
  await this.db.otps.findOneAndUpdate({sub},{$set:{email,hash:hashCode(code),attempts:0,expiresAt:new Date(Date.now()+600000)}},{upsert:true});
  await this.mailer.send(email,'Your Carpschool verification code','Your code is '+code+'. It expires in 10 minutes.');return {sent:true};
 }
 async verifyOtp(sub:string,code:string){
  const otp=await this.db.otps.findOneAndUpdate({sub,expiresAt:{$gt:new Date()},attempts:{$lt:5}},{$inc:{attempts:1}},{new:true});
  if(!otp||!compareCode(code,otp.hash))throw new BadRequestException('Invalid or expired code');
  return this.transaction(async session=>{
   const consume=await this.db.otps.deleteOne({_id:otp._id,hash:otp.hash},{session});if(!consume.deletedCount)throw new ConflictException('Code already used');
   await this.db.emails.updateOne({email:otp.email},{$setOnInsert:{subs:[]}},{upsert:true,session});
   const slots=await this.db.emails.findOneAndUpdate({email:otp.email,subs:{$ne:sub},$expr:{$lt:[{$size:'$subs'},loadConfig().MAX_USERS_PER_EDU_EMAIL]}},{$addToSet:{subs:sub}},{new:true,session});
   if(!slots)throw new ConflictException('School email account limit reached');
   await this.db.users.updateOne({sub,verified:false},{$set:{verified:true,eduEmail:otp.email}},{session});return {verified:true};
  });
 }
 async profile(sub:string,body:any){
  await this.ready(sub);
  const updated=await this.db.users.findOneAndUpdate({sub,role:{$exists:false}},{$set:body},{new:true}).lean<any>();
  if(!updated)throw new ConflictException('Role is permanently locked');return updated;
 }
 async addHome(sub:string,body:any){await this.ready(sub);return this.transaction(async session=>{const reserved=await this.db.users.findOneAndUpdate({sub,homeCount:{$lt:loadConfig().MAX_HOMES_PER_USER}},{$inc:{homeCount:1}},{session,new:true});if(!reserved)throw new ConflictException('Home limit reached');return (await this.db.homes.create([{owner:sub,...body}],{session}))[0];});}
 async deleteHome(sub:string,id:string){await this.ready(sub);return this.transaction(async session=>{const h=await this.db.homes.findOneAndDelete({_id:objectId(id),owner:sub},{session});if(!h)throw new NotFoundException();await this.db.users.updateOne({sub},{$inc:{homeCount:-1}},{session});return {deleted:true};});}
 async createRequest(sub:string,b:any){await this.ready(sub,'rider');const home=await this.owner(this.db.homes,b.homeId,sub);return this.db.requests.create({owner:sub,...b,location:home.location,walkingRadius:home.walkingRadius});}
 async createDrive(sub:string,b:any){await this.ready(sub,'driver');await this.owner(this.db.homes,b.homeId,sub);return this.db.drives.create({owner:sub,...b,route:{type:'LineString',coordinates:b.route},seats:b.seats,availableSeats:b.seats,passengers:[]});}
 async blocked(a:string,b:string){return !!await this.db.blocks.exists({$or:[{owner:a,subject:b},{owner:b,subject:a}]});}
 compatible(a:any,b:any){return a.direction===b.direction&&a.startTime<=b.endTime&&b.startTime<=a.endTime&&(a.dates.some((d:string)=>b.dates.includes(d))||a.days.some((d:number)=>b.days.includes(d))||a.dates.some((d:string)=>b.days.includes(new Date(d+'T12:00:00Z').getUTCDay()))||b.dates.some((d:string)=>a.days.includes(new Date(d+'T12:00:00Z').getUTCDay())));}
 async matches(sub:string,driveId:string){
  await this.ready(sub,'driver');const drive=await this.owner(this.db.drives,driveId,sub);
  if(drive.status!=='active'||drive.availableSeats<1)return [];
  const corridor=buffer(lineString(drive.route.coordinates),0.2,{units:'kilometers'});if(!corridor)throw new BadRequestException('Invalid corridor');
  const candidates=await this.db.requests.find({status:'active',direction:drive.direction,location:{$geoWithin:{$geometry:corridor.geometry}}}).limit(200).lean<any>();
  const matches=[];for(const req of candidates){if(!this.compatible(drive,req)||await this.blocked(sub,req.owner))continue;const distance=pointToLineDistance(point(req.location.coordinates),lineString(drive.route.coordinates),{units:'meters'});if(distance<=req.walkingRadius)matches.push({requestId:String(req._id),rider:req.owner,distanceMeters:Math.round(distance),startTime:req.startTime,endTime:req.endTime});}return matches.sort((a,b)=>a.distanceMeters-b.distanceMeters);
 }
 async reachOut(sub:string,driveId:string,requestId:string){await this.ready(sub,'driver');const drive=await this.owner(this.db.drives,driveId,sub);const req=await this.db.requests.findOne({_id:objectId(requestId),status:'active'}).lean<any>();if(!req||drive.status!=='active'||!this.compatible(drive,req)||await this.blocked(sub,req.owner))throw new NotFoundException();const distance=pointToLineDistance(point(req.location.coordinates),lineString(drive.route.coordinates),{units:'meters'});if(distance>req.walkingRadius)throw new BadRequestException('Rider is outside corridor');return this.db.negotiations.findOneAndUpdate({driveId,requestId},{$setOnInsert:{driver:sub,rider:req.owner,status:'open'}},{upsert:true,new:true}).lean<any>();}
 async participant(sub:string,id:string){await this.ready(sub);const n=await this.db.negotiations.findOne({_id:objectId(id),$or:[{driver:sub},{rider:sub}]}).lean<any>();if(!n)throw new NotFoundException();if(await this.blocked(n.driver,n.rider))throw new ForbiddenException('Conversation blocked');return n;}
 async message(sub:string,id:string,text:string){const n=await this.participant(sub,id);if(n.status!=='open')throw new ConflictException('Conversation closed');await this.limit('message:'+sub,30,60);return this.db.messages.create({negotiationId:id,author:sub,text});}
 async propose(sub:string,id:string,b:any){const n=await this.participant(sub,id);if(n.status!=='open')throw new ConflictException('Conversation closed');await this.limit('proposal:'+sub,10,60);return this.db.proposals.create({negotiationId:id,author:sub,...b});}
 async accept(sub:string,id:string,proposalId:string){
  const n=await this.participant(sub,id);
  const result=await this.transaction(async session=>{
   const p=await this.db.proposals.findOneAndUpdate({_id:objectId(proposalId),negotiationId:id,author:{$ne:sub},status:'pending'},{$set:{status:'accepted'}},{session,new:true}).lean<any>();if(!p)throw new ConflictException('Proposal unavailable or not yours to accept');
   const conversation=await this.db.negotiations.findOneAndUpdate({_id:id,status:'open'},{$set:{status:'locked'}},{session,new:true});if(!conversation)throw new ConflictException('Already locked');
   const req=await this.db.requests.findOneAndUpdate({_id:n.requestId,status:'active'},{$set:{status:'locked'}},{session,new:true});if(!req)throw new ConflictException('Rider request already locked');
   const pin=randomInt(0,10000).toString().padStart(4,'0');
   const booked=await this.db.drives.findOneAndUpdate({_id:n.driveId,status:'active',availableSeats:{$gt:0},'passengers.rider':{$ne:n.rider}},{$inc:{availableSeats:-1},$push:{passengers:{rider:n.rider,negotiationId:id,proposalId,pickup:p.pickup,time:p.time,pinHash:hashCode(pin),pinAttempts:0,status:'locked'}}},{new:true,session}).lean<any>();
   if(!booked)throw new ConflictException('No seats available');
   return {driveId:n.driveId,negotiationId:id,...(sub===n.rider?{pin}:{})};
  });
  for(const person of [n.driver,n.rider]){const u=await this.db.users.findOne({sub:person}).lean<any>();if(u?.eduEmail)await this.mailer.notify(u.eduEmail,'Carpool confirmed','Your carpool is confirmed. Open Carpschool to see the pickup and boarding PIN.');}return result;
 }
 async carpool(sub:string,id:string){await this.ready(sub);const d=await this.db.drives.findOne({_id:objectId(id),$or:[{owner:sub},{'passengers.rider':sub}]}).lean<any>();if(!d)throw new NotFoundException();if(d.owner!==sub){d.passengers=d.passengers.filter((p:any)=>p.rider===sub);delete d.route;}return d;}
 async pin(sub:string,id:string){await this.ready(sub,'rider');await this.limit('pin-reset:'+sub,5,3600);const pin=randomInt(0,10000).toString().padStart(4,'0');const d=await this.db.drives.findOneAndUpdate({_id:objectId(id),passengers:{$elemMatch:{rider:sub,status:'locked',pinAttempts:{$lt:5}}}},{$set:{'passengers.$.pinHash':hashCode(pin)}},{new:true});if(!d)throw new NotFoundException();return {pin};}
 async board(sub:string,id:string,rider:string,pin:string,location:any){await this.ready(sub,'driver');return this.transaction(async session=>{
  const d=await this.db.drives.findOneAndUpdate({_id:objectId(id),owner:sub,status:'active',passengers:{$elemMatch:{rider,status:'locked',pinAttempts:{$lt:5}}}},{$inc:{'passengers.$.pinAttempts':1}},{new:true,session}).select('+passengers.pinHash').lean<any>();if(!d)throw new ConflictException('Passenger unavailable or PIN locked');
  const passenger=d.passengers.find((p:any)=>p.rider===rider);
  if(!compareCode(pin,passenger.pinHash))return {invalid:true};
  await this.db.drives.updateOne({_id:id,'passengers.rider':rider},{$set:{'passengers.$.status':'boarded'},$unset:{'passengers.$.pinHash':1}},{session});
  await this.db.events.create([{driveId:id,rider,driver:sub,kind:'board',location,time:new Date()}],{session});return {boarded:true};
 });}
 async dropoff(sub:string,id:string,rider:string,location:any){await this.ready(sub,'driver');return this.transaction(async session=>{const d=await this.db.drives.findOneAndUpdate({_id:objectId(id),owner:sub,passengers:{$elemMatch:{rider,status:'boarded'}}},{$set:{'passengers.$.status':'completed'},$inc:{availableSeats:1}},{session,new:true});if(!d)throw new ConflictException('Passenger not boarded');await this.db.events.create([{driveId:id,rider,driver:sub,kind:'dropoff',location,time:new Date()}],{session});return {completed:true};});}
 async leave(sub:string,id:string,rider:string){await this.ready(sub);const result=await this.transaction(async session=>{const d=await this.db.drives.findOne({_id:objectId(id),$or:[{owner:sub},{'passengers.rider':sub}]}).session(session).lean<any>();if(!d||(d.owner!==sub&&rider!==sub))throw new NotFoundException();const p=d.passengers.find((p:any)=>p.rider===rider);if(!p||p.status!=='locked')throw new ConflictException('Only unboarded bookings can be cancelled');const updated=await this.db.drives.updateOne({_id:id,passengers:{$elemMatch:{rider,status:'locked'}}},{$pull:{passengers:{rider}},$inc:{availableSeats:1}},{session});if(!updated.modifiedCount)throw new ConflictException();await this.db.negotiations.updateOne({_id:p.negotiationId},{$set:{status:'cancelled'}},{session});const n=await this.db.negotiations.findById(p.negotiationId).session(session).lean<any>();if(n)await this.db.requests.updateOne({_id:n.requestId,status:'locked'},{$set:{status:'active'}},{session});return {left:true,driver:d.owner};});await this.notifyCancellation([result.driver,rider]);return {left:true};}
 async cancelDrive(sub:string,id:string){await this.ready(sub,'driver');const result=await this.transaction(async session=>{const d=await this.db.drives.findOne({_id:objectId(id),owner:sub,status:'active','passengers.status':{$ne:'boarded'}}).session(session).lean<any>();if(!d)throw new ConflictException('Drive unavailable or passenger boarded');await this.db.drives.updateOne({_id:id},{$set:{status:'cancelled',passengers:[],availableSeats:d.seats}},{session});await this.db.negotiations.updateMany({driveId:id},{$set:{status:'cancelled'}},{session});const ns=await this.db.negotiations.find({driveId:id}).session(session).lean<any>();await this.db.requests.updateMany({_id:{$in:ns.map((n:any)=>n.requestId)},status:'locked'},{$set:{status:'active'}},{session});return {cancelled:true,riders:d.passengers.map((p:any)=>p.rider)};});await this.notifyCancellation([sub,...result.riders]);return {cancelled:true};}
 async notifyCancellation(subs:string[]){for(const sub of new Set(subs)){const u=await this.db.users.findOne({sub}).lean<any>();if(u?.eduEmail)await this.mailer.notify(u.eduEmail,'Carpool cancelled','Your carpool booking was cancelled. Open Carpschool for details.');}}
}
