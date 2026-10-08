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
const temp=mkdtempSync(join(tmpdir(),'carpschool-settings-'));
const key=generateKeyPairSync('ed25519');
let alice:string,admin:string;
async function ticket(sub:string,extra:any={},signing=key.privateKey){return new SignJWT({schoolAdmin:false,...extra}).setProtectedHeader({alg:'EdDSA',kid:'test'}).setSubject(sub).setIssuer('https://central.test').setAudience('kjt').setIssuedAt().setExpirationTime('15m').setJti(randomUUID()).sign(signing);}
async function session(sub:string,extra:any={}){return (await auth.exchange(await ticket(sub,extra))).token;}
before(async()=>{
 mongo=await MongoMemoryReplSet.create({replSet:{count:1}});
 writeFileSync(join(temp,'key.pem'),key.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
 writeFileSync(join(temp,'jwks.json'),JSON.stringify({keys:[{...await exportJWK(key.publicKey),kid:'test',alg:'EdDSA'}]}));
 Object.assign(process.env,{NODE_ENV:'test',MONGO_URI:mongo.getUri(),TEST_JWKS_PATH:join(temp,'jwks.json')});setDataDir(join(temp,'data'));
 app=await NestFactory.create(AppModule,{logger:false});await app.listen(0,'127.0.0.1');url=await app.getUrl();
 db=app.get(Database);
 await db.settings.updateOne({key:'school'},{$set:{value:{configured:true,schoolCode:'kjt',centralUrl:'https://central.test',officialName:'KJT',publicUrl:'https://school.test',corsOrigins:[],emailRules:[{type:'domain',value:'kjt.lol'}],mailer:{provider:'test',fromName:'KJT'}}}},{upsert:true});app.get(SettingsService).cache=undefined;
 auth=app.get(Auth);service=app.get(SchoolService);mailer=app.get(Mailer);
 alice=await session('alice');admin=await session('admin',{schoolAdmin:true});
 await db.users.updateOne({sub:'alice'},{$set:{verified:true,eduEmail:'alice@kjt.lol',role:'driver'}});
}, {timeout:120000});
after(async()=>{await app?.close();await mongo?.stop();rmSync(temp,{recursive:true,force:true});});
const H=()=>request(app.getHttpServer());
test('settings require school admin',async()=>{await H().get('/admin/settings').expect(401);await H().get('/admin/settings').auth(alice,{type:'bearer'}).expect(403);await H().put('/admin/settings').auth(alice,{type:'bearer'}).send({officialName:'Pwned'}).expect(403);});
test('settings come from DB and hide secrets',async()=>{const r=await H().get('/admin/settings').auth(admin,{type:'bearer'}).expect(200);assert.equal(r.body.officialName,'KJT');assert.deepEqual(r.body.emailRules,[{type:'domain',value:'kjt.lol'}]);assert.equal(r.body.mailer.refreshToken,undefined);assert.equal(r.body.mailer.clientSecret,undefined);assert.equal(typeof r.body.mailer.refreshTokenSet,'boolean');});
test('settings validation rejects bad input',async()=>{for(const bad of [{officialName:''},{emailRules:[]},{emailRules:[{type:'domain',value:'not a domain'}]},{emailRules:[{type:'regex',value:'(a'}]},{emailRules:[{type:'regex',value:'(a+)\\1'}]},{emailRules:[{type:'regex',value:'a'.repeat(201)}]},{emailRules:[{type:'wild',value:'x'}]},{schoolCode:'x'},{centralUrl:'https://evil.test'},{publicUrl:'http://plain.example'},{corsOrigins:['https://a.test/path']},{limits:{maxCarpoolStudents:99,maxHomesPerUser:1,maxUsersPerEduEmail:1}},{campus:{name:'x',address:'',latitude:200,longitude:0}},{unknown:1},{mailer:{gmailUser:'nope'}}])await H().put('/admin/settings').auth(admin,{type:'bearer'}).send(bad).expect(400);});
test('settings persist in DB and drive runtime behaviour',async()=>{
 const r=await H().put('/admin/settings').auth(admin,{type:'bearer'}).send({officialName:'KJT Secondary',campus:{name:'Main campus',address:'1 Test Rd',latitude:49.1,longitude:-123.1},emailRules:[{type:'domain',value:'KJT.lol'},{type:'domain',value:'students.kjt.lol'},{type:'domain',value:'kjt.lol'}],corsOrigins:['https://app.test'],limits:{maxCarpoolStudents:2,maxHomesPerUser:1,maxUsersPerEduEmail:3},mailer:{fromName:'KJT Rides',refreshToken:'r-secret'}}).expect(200);
 assert.deepEqual(r.body.emailRules.map((x:any)=>x.value),['kjt.lol','students.kjt.lol']);assert.equal(r.body.mailer.refreshTokenSet,true);assert.equal(JSON.stringify(r.body).includes('r-secret'),false);
 const saved=await db.settings.findOne({key:'school'}).lean();assert.equal(saved.value.limits.maxCarpoolStudents,2);
 const meta=await H().get('/.well-known/carpschool.json').expect(200);assert.equal(meta.body.name,'KJT Secondary');assert.deepEqual(meta.body.campus.coordinates,[-123.1,49.1]);assert.equal(meta.body.limits.seats,2);
 const h=await service.addHome('alice',{label:'A',location:{type:'Point',coordinates:[-123,49]},walkingRadius:50});
 await assert.rejects(service.addHome('alice',{label:'B',location:{type:'Point',coordinates:[-123,49]},walkingRadius:50}));
 await H().post('/drives').auth(alice,{type:'bearer'}).send({commute:{homeId:String(h._id),direction:'to-school',days:[1],startTime:'08:00',endTime:'08:30'},route:[[-123,49],[-123.1,49.1]],seats:3}).expect(400);
 await H().put('/admin/settings').auth(admin,{type:'bearer'}).send({mailer:{refreshToken:null}}).expect(200).then(x=>assert.equal(x.body.mailer.refreshTokenSet,false));
});

test('email rules: domain + anchored regex, RE2, test box, metadata shows only domains',async()=>{
 const A=()=>H().put('/admin/email-rules').auth(admin,{type:'bearer'});
 await A().send([{type:'domain',value:'kjt.lol'},{type:'regex',value:'[a-z]+\\.[0-9]{2}@students\\.kjt\\.lol'}]).expect(200);
 assert.equal(await service.settings.emailAllowed('ann.27@students.kjt.lol'),true);
 assert.equal(await service.settings.emailAllowed('x@kjt.lol'),true);
 assert.equal(await service.settings.emailAllowed('evil+ann.27@students.kjt.lol.attacker.com'),false,'anchored');
 assert.equal(await service.settings.emailAllowed('ann.27@students.kjt.lolx'),false,'anchored end');
 const meta=await H().get('/.well-known/carpschool.json').expect(200);assert.deepEqual(meta.body.domains,['kjt.lol']);
 const evil='a'.repeat(50000)+'!';const t0=Date.now();
 const r=await H().post('/admin/email-rules/test').auth(admin,{type:'bearer'}).send({email:evil.slice(0,240)+'@x.io',rules:[{type:'regex',value:'(a+)+@x\\.io!'}]}).expect(201);assert.equal(r.body.allowed,false);assert(Date.now()-t0<2000);
 const ok=await H().post('/admin/email-rules/test').auth(admin,{type:'bearer'}).send({email:'ann.27@students.kjt.lol',rules:[{type:'regex',value:'.*@students\\.kjt\\.lol'}]}).expect(201);assert.equal(ok.body.allowed,true);assert.equal(ok.body.matched.type,'regex');
 await H().post('/admin/email-rules/test').auth(admin,{type:'bearer'}).send({email:'a@b.c',rules:[{type:'regex',value:'(?=a)'}]}).expect(400);
 await H().post('/admin/email-rules/test').auth(alice,{type:'bearer'}).send({email:'a@b.c',rules:[{type:'domain',value:'kjt.lol'}]}).expect(403);
 await A().send([{type:'domain',value:'kjt.lol'}]).expect(200);
});
