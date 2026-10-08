import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { createConnection, Connection, Schema, Model } from 'mongoose';
import { loadConfig } from './config.js';
const point = {type: {type: String, enum:['Point'], default:'Point'}, coordinates: {type:[Number], required:true}};
@Injectable()
export class Database implements OnModuleInit, OnModuleDestroy {
 connection!: Connection;
 users!: Model<any>; sessions!: Model<any>; replays!: Model<any>; otps!: Model<any>; emails!: Model<any>;
 homes!: Model<any>; requests!: Model<any>; drives!: Model<any>; negotiations!: Model<any>; messages!: Model<any>; proposals!: Model<any>; reports!: Model<any>; blocks!: Model<any>; events!: Model<any>; limits!: Model<any>; settings!: Model<any>; mailerStates!: Model<any>; mailerNonces!: Model<any>;
 async onModuleInit() {
  this.connection = await createConnection(loadConfig().MONGO_URI).asPromise();
  const make = (name: string, fields: any, indexes: any[] = []) => {
   const s = new Schema(fields,{timestamps:true,strict:true});
   indexes.forEach(([keys,opts])=>s.index(keys,opts)); return this.connection.model<any>(name,s);
  };
  this.users=make('User',{sub:{type:String,unique:true},eduEmail:String,verified:{type:Boolean,default:false},avatar:String,role:{type:String,enum:['rider','driver']},name:String,phone:String,personalEmail:String,car:Schema.Types.Mixed,licenseConfirmed:Boolean,banned:{type:Boolean,default:false},homeCount:{type:Number,default:0}});
  this.sessions=make('Session',{hash:{type:String,unique:true},sub:String,schoolAdmin:Boolean,expiresAt:Date},[[{expiresAt:1},{expireAfterSeconds:0}]]);
  this.replays=make('TicketReplay',{jti:{type:String,unique:true},expiresAt:Date},[[{expiresAt:1},{expireAfterSeconds:0}]]);
  this.otps=make('Otp',{sub:{type:String,unique:true},email:String,hash:String,attempts:{type:Number,default:0},expiresAt:Date},[[{expiresAt:1},{expireAfterSeconds:0}]]);
  this.emails=make('EduEmail',{email:{type:String,unique:true},subs:[String]});
  this.homes=make('Home',{owner:String,label:String,location:point,walkingRadius:Number},[[{location:'2dsphere'},{}]]);
  const commute={owner:String,homeId:String,direction:String,dates:[String],days:[Number],startTime:String,endTime:String,status:{type:String,default:'active'}};
  this.requests=make('RideRequest',{...commute,location:point,walkingRadius:Number},[[{location:'2dsphere'},{}]]);
  this.drives=make('Drive',{...commute,route:{type:{type:String,enum:['LineString'],default:'LineString'},coordinates:[[Number]]},availableSeats:Number,seats:Number,passengers:[{rider:String,negotiationId:String,proposalId:String,pickup:point,time:String,pinHash:{type:String,select:false},pinAttempts:{type:Number,default:0},status:{type:String,default:'locked'}}]},[[{route:'2dsphere'},{}]]);
  this.negotiations=make('Negotiation',{driver:String,rider:String,driveId:String,requestId:String,status:{type:String,default:'open'},round:{type:Number,default:0}},[[{driveId:1,requestId:1,round:1},{unique:true}]]);
  this.messages=make('Message',{negotiationId:String,author:String,text:String});
  this.proposals=make('Proposal',{negotiationId:String,author:String,pickup:point,time:String,status:{type:String,default:'pending'}});
  this.reports=make('Report',{reporter:String,subject:String,reason:String,status:{type:String,default:'open'}});
  this.blocks=make('Block',{owner:String,subject:String},[[{owner:1,subject:1},{unique:true}]]);
  this.events=make('Event',{driveId:String,rider:String,driver:String,kind:String,location:point,approximate:{type:Boolean,default:false},time:Date});
  this.limits=make('RateLimit',{key:{type:String,unique:true},count:Number,expiresAt:Date},[[{expiresAt:1},{expireAfterSeconds:0}]]);
  this.settings=make('Setting',{key:{type:String,unique:true},value:Schema.Types.Mixed});
  this.mailerStates=make('MailerState',{key:{type:String,unique:true},keyId:String,salt:String,publicKey:String,ivCounter:Number,token:Schema.Types.Mixed,expiresAt:Date,lastPushAt:Date,lastTs:Number});
  this.mailerNonces=make('MailerNonce',{keyId:String,nonce:String,expiresAt:Date},[[{keyId:1,nonce:1},{unique:true}],[{expiresAt:1},{expireAfterSeconds:0}]]);
  // v1 allowed one conversation per drive/request forever; rounds let a closed one be replaced by a fresh conversation.
  await this.negotiations.collection.dropIndex('driveId_1_requestId_1').catch(()=>{});
  await Promise.all(Object.values(this).filter(v=>v && typeof v.init==='function').map(v=>v.init()));
 }
 async onModuleDestroy(){await this.connection?.close();}
}
