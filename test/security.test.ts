import 'reflect-metadata';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { SignJWT, exportJWK } from 'jose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { io } from 'socket.io-client';
import { AppModule } from '../dist/app.js';
import { Database } from '../dist/database.js';
import { Auth, hashCode, compareCode } from '../dist/security.js';
import { SchoolService } from '../dist/school.service.js';
import { Mailer } from '../dist/mailer.js';
import { setDataDir } from '../dist/config.js';
import { SettingsService } from '../dist/settings.js';
let mongo:any, app:any, db:any, auth:any, service:any, mailer:any, url:string;
const temp=mkdtempSync(join(tmpdir(),'carpschool-tests-'));
const key=generateKeyPairSync('ed25519');
let alice:string,bob:string,driver:string,admin:string;
async function ticket(sub:string,extra:any={},signing=key.privateKey){return new SignJWT({schoolAdmin:false,...extra}).setProtectedHeader({alg:'EdDSA',kid:'test'}).setSubject(sub).setIssuer('https://central.test').setAudience('kjt').setIssuedAt().setExpirationTime('15m').setJti(randomUUID()).sign(signing);}
async function session(sub:string,extra:any={}){return (await auth.exchange(await ticket(sub,extra))).token;}
before(async()=>{
 mongo=await MongoMemoryReplSet.create({replSet:{count:1}});
 writeFileSync(join(temp,'key.pem'),key.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
 writeFileSync(join(temp,'jwks.json'),JSON.stringify({keys:[{...await exportJWK(key.publicKey),kid:'test',alg:'EdDSA'}]}));
 Object.assign(process.env,{NODE_ENV:'test',MONGO_URI:mongo.getUri(),TEST_JWKS_PATH:join(temp,'jwks.json')});setDataDir(join(temp,'data'));
 app=await NestFactory.create(AppModule,{logger:false});await app.listen(0,'127.0.0.1');url=await app.getUrl();
 db=app.get(Database);
 await db.settings.updateOne({key:'school'},{$set:{value:{configured:true,schoolCode:'kjt',centralUrl:'https://central.test',officialName:'KJT',publicUrl:'https://school.test',corsOrigins:[],email:{mode:'domains',domains:['kjt.lol']},mailer:{provider:'test',fromName:'KJT'}}}},{upsert:true});app.get(SettingsService).cache=undefined;
 auth=app.get(Auth);service=app.get(SchoolService);mailer=app.get(Mailer);
 alice=await session('alice');bob=await session('bob');driver=await session('driver');admin=await session('admin',{schoolAdmin:true});
 for(const [sub,role] of [['alice','rider'],['bob','rider'],['driver','driver']])await db.users.updateOne({sub},{$set:{verified:true,eduEmail:sub+'@kjt.lol',role}});
}, {timeout:120000});
after(async()=>{await app?.close();await mongo?.stop();rmSync(temp,{recursive:true,force:true});});
test('salted OTP/PIN hash verifies only correct value',()=>{const h=hashCode('1234');assert(compareCode('1234',h));assert(!compareCode('0000',h));assert.notEqual(hashCode('1234'),h);});
test('forged embedded public key cannot authorize',async()=>{const attacker=generateKeyPairSync('ed25519');const forged=await ticket('attacker',{jwk:await exportJWK(attacker.publicKey),schoolAdmin:true},attacker.privateKey);await assert.rejects(auth.exchange(forged));});
test('wrong audience rejected',async()=>{const t=await new SignJWT({}).setProtectedHeader({alg:'EdDSA',kid:'test'}).setSubject('a').setIssuer('https://central.test').setAudience('other').setIssuedAt().setExpirationTime('15m').setJti(randomUUID()).sign(key.privateKey);await assert.rejects(auth.exchange(t));});
test('expired tickets rejected',async()=>{const t=await new SignJWT({}).setProtectedHeader({alg:'EdDSA',kid:'test'}).setSubject('a').setIssuer('https://central.test').setAudience('kjt').setIssuedAt(Math.floor(Date.now()/1000)-1000).setExpirationTime(Math.floor(Date.now()/1000)-5).setJti(randomUUID()).sign(key.privateKey);await assert.rejects(auth.exchange(t));});
test('ticket exchange replay is atomically rejected',async()=>{const t=await ticket('replay');const results=await Promise.allSettled([auth.exchange(t),auth.exchange(t)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);});
test('HTTP auth and admin ownership gates',async()=>{await request(app.getHttpServer()).get('/me').expect(401);await request(app.getHttpServer()).get('/admin/users').auth(alice,{type:'bearer'}).expect(403);await request(app.getHttpServer()).get('/admin/users').auth(admin,{type:'bearer'}).expect(200);await request(app.getHttpServer()).get('/admin/users/aaaaaaaaaaaaaaaaaaaaaaaa').auth(alice,{type:'bearer'}).expect(403);await request(app.getHttpServer()).get('/admin/users/aaaaaaaaaaaaaaaaaaaaaaaa').auth(admin,{type:'bearer'}).expect(404);const any=(await request(app.getHttpServer()).get('/admin/users').auth(admin,{type:'bearer'})).body[0];if(any){const d=await request(app.getHttpServer()).get('/admin/users/'+any._id).auth(admin,{type:'bearer'}).expect(200);assert.equal(d.body.user.sub,any.sub);assert.ok(Array.isArray(d.body.homes));}});
test('DTO rejects unvalidated home radius and unknown fields',async()=>{await request(app.getHttpServer()).post('/homes').auth(alice,{type:'bearer'}).send({label:'Home',location:{type:'Point',coordinates:[-123,49]},walkingRadius:999,owner:'bob'}).expect(400);});
test('home ownership IDOR and concurrency home limit',async()=>{const h=await service.addHome('alice',{label:'Home',location:{type:'Point',coordinates:[-123,49]},walkingRadius:100});await request(app.getHttpServer()).delete('/homes/'+h._id).auth(bob,{type:'bearer'}).expect(404);const results=await Promise.allSettled(Array.from({length:5},(_,i)=>service.addHome('alice',{label:'H'+i,location:{type:'Point',coordinates:[-123,49]},walkingRadius:100})));assert.equal(results.filter(r=>r.status==='fulfilled').length,2);assert.equal(await db.homes.countDocuments({owner:'alice'}),3);});
test('edu OTP expiry attempts limits and mandatory domain',async()=>{await session('student');await assert.rejects(service.sendOtp('student','a@example.com','1.1.1.1'));await service.sendOtp('student','student@kjt.lol','1.1.1.1');const code=mailer.testMessages.at(-1).text.match(/code is (\d{6})/)[1];for(let i=0;i<5;i++)await assert.rejects(service.verifyOtp('student',code==='000000'?'111111':'000000'));await assert.rejects(service.verifyOtp('student',code));await assert.rejects(service.sendOtp('student','student@kjt.lol','1.1.1.1'));});
test('edu address cap and locked profile role',async()=>{await session('student2');await service.sendOtp('student2','ok@kjt.lol','2.2.2.2');const code=mailer.testMessages.at(-1).text.match(/code is (\d{6})/)[1];assert.deepEqual(await service.verifyOtp('student2',code),{verified:true});await service.profile('student2',{role:'rider',name:'Student',phone:'12345678'});await assert.rejects(service.profile('student2',{role:'driver',name:'Student',phone:'12345678'}));await session('student3');await service.sendOtp('student3','ok@kjt.lol','3.3.3.3');const c=mailer.testMessages.at(-1).text.match(/code is (\d{6})/)[1];await assert.rejects(service.verifyOtp('student3',c));});
let booking:any;
test('simultaneous acceptance cannot overbook one seat',async()=>{
 const d=await db.drives.create({owner:'driver',seats:1,availableSeats:1,passengers:[],status:'active',route:{type:'LineString',coordinates:[[-123,49],[-123.001,49.001]]}});
 const proposals=[];for(const sub of ['alice','bob']){const r=await db.requests.create({owner:sub,status:'active',location:{type:'Point',coordinates:[-123,49]}});const n=await db.negotiations.create({driver:'driver',rider:sub,driveId:String(d._id),requestId:String(r._id),status:'open'});const p=await db.proposals.create({negotiationId:String(n._id),author:'driver',pickup:{type:'Point',coordinates:[-123,49]},time:'08:00'});proposals.push({sub,id:String(n._id),proposalId:String(p._id)});}
 const results=await Promise.allSettled(proposals.map(p=>service.accept(p.sub,p.id,p.proposalId)));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const saved=await db.drives.findById(d._id).lean();assert.equal(saved.availableSeats,0);assert.equal(saved.passengers.length,1);
 const index=results.findIndex(r=>r.status==='fulfilled');booking={...proposals[index],driveId:String(d._id),pin:(results[index] as any).value.pin};
});
test('participant-only negotiation and carpool pin privacy',async()=>{const stranger=booking.sub==='alice'?'bob':'alice';await assert.rejects(service.participant(stranger,booking.id));await assert.rejects(service.carpool(stranger,booking.driveId));const view=await service.carpool('driver',booking.driveId);assert(!JSON.stringify(view).includes('pinHash'));});
test('boarding/dropoff records exactly discrete snapshots and no replay',async()=>{const loc={type:'Point',coordinates:[-123,49]};assert.deepEqual(await service.board('driver',booking.driveId,booking.sub,'xxxxx',loc),{invalid:true});assert.deepEqual(await service.board('driver',booking.driveId,booking.sub,booking.pin,loc),{boarded:true});await assert.rejects(service.board('driver',booking.driveId,booking.sub,booking.pin,loc));assert.deepEqual(await service.dropoff('driver',booking.driveId,booking.sub,loc),{completed:true});assert.equal(await db.events.countDocuments({driveId:booking.driveId}),2);const ev=await db.events.findOne({driveId:booking.driveId,kind:'dropoff'}).lean<any>();assert.equal(ev.approximate,false,JSON.stringify(ev));await service.cancelDrive('driver',booking.driveId);const after=await db.drives.findById(booking.driveId).lean<any>();assert.equal(after.status,'cancelled');assert.equal(after.passengers.find((p:any)=>p.rider===booking.sub)?.status,'completed');});
test('leaving keeps the booking in history as left',async()=>{const other=booking.sub==='alice'?'bob':'alice';const base=await db.drives.findById(booking.driveId).lean<any>();const {_id,passengers,createdAt,updatedAt,__v,...rest}=base;const n=await db.negotiations.create({driver:'driver',rider:other,driveId:'x'+Date.now(),requestId:'0123456789abcdef0123'+String(Date.now()).slice(-4),status:'locked'});const d=await db.drives.create({...rest,status:'active',availableSeats:base.seats-1,passengers:[{rider:other,negotiationId:String(n._id),pickup:{type:'Point',coordinates:[-123,49]},time:'07:40',status:'locked'}]});assert.deepEqual(await service.leave('driver',String(d._id),other),{left:true});const after=await db.drives.findById(d._id).lean<any>();assert.equal(after.passengers.length,1);assert.equal(after.passengers[0].status,'left');assert.equal(after.availableSeats,base.seats);});
test('socket rejects missing authentication and non-participant join',async()=>{
 const unauth=io(url,{reconnection:false,transports:['websocket'],timeout:2000});await new Promise<void>(resolve=>{unauth.on('disconnect',()=>resolve());unauth.on('connect_error',()=>resolve());});unauth.close();
 const stranger=booking.sub==='alice'?bob:alice;const socket=io(url,{auth:{token:stranger},transports:['websocket'],reconnection:false});await new Promise<void>((resolve,reject)=>{socket.on('connect',()=>resolve());socket.on('connect_error',reject);});const error=await new Promise<any>(resolve=>{const timer=setTimeout(()=>resolve({timeout:true}),3000);socket.once('exception',(e)=>{clearTimeout(timer);resolve(e)});socket.emit('negotiation:join',{negotiationId:booking.id});});socket.close();assert(error&&!error.timeout);
});
