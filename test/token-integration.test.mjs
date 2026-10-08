import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NestFactory} from '@nestjs/core';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {randomBytes,randomUUID,sign,createCipheriv} from 'node:crypto';
import {AppModule} from '../dist/app.js';
import {Database} from '../dist/database.js';
import {SettingsService} from '../dist/settings.js';
import {AppsScriptTokens} from '../dist/appsscript.js';
import {setDataDir} from '../dist/config.js';
import {digest} from '../dist/security.js';
process.env.NODE_ENV='test';setDataDir(mkdtempSync(tmpdir()+'/cs-token-integration-'));
test('real Mongo indexes, restart replay, rotation and HTTP admin guards',async()=>{
 const app=await NestFactory.create(AppModule,{logger:false});await app.listen(0,'127.0.0.1');
 const db=app.get(Database),settings=app.get(SettingsService),tokens=app.get(AppsScriptTokens),url=await app.getUrl();
 try{
 await settings.write({configured:true,schoolCode:'sss',centralUrl:'https://central.test',publicUrl:'https://school.test',mailer:{provider:'appsscript',url:'https://script.google.com/macros/s/interim/exec',secret:'interim-secret',fromName:'School'}});
 for(const admin of [true,false]){const sub=admin?'admin':'student';await db.users.create({sub});await db.sessions.create({hash:digest(sub),sub,schoolAdmin:admin,expiresAt:new Date(Date.now()+600000)});}
 const request=(path,method='GET',body,session)=>fetch(url+path,{method,headers:{'Content-Type':'application/json',...(session?{Authorization:'Bearer '+session}:{})},...(body?{body:JSON.stringify(body)}:{})});
 for(const path of ['/admin/mailer/appsscript/status','/admin/mailer']){assert.equal((await request(path)).status,401);assert.equal((await request(path,'GET',undefined,'student')).status,403);}
 assert.equal((await request('/admin/mailer/appsscript/generate','POST',{})).status,401);assert.equal((await request('/admin/mailer/appsscript/generate','POST',{},'student')).status,403);
 const response=await request('/admin/mailer/appsscript/generate','POST',{},'admin');assert.equal(response.status,201);assert.equal(response.headers.get('cache-control'),'no-store');const generated=await response.json(),c=JSON.parse(generated.codeGs.match(/var CS_CONFIG=(.*?);function/)[1]);
 assert.equal((await request('/admin/mailer/appsscript/generate','POST',{},'admin')).status,409);
 const makeReservation=()=>{const r={keyId:generated.keyId,ts:Date.now(),nonce:randomUUID()};return {...r,signature:sign('RSA-SHA256',Buffer.from('carpschool-appsscript-iv:'+r.keyId+':'+r.ts+':'+r.nonce),c.privateKey).toString('base64url')};};
 const reservations=await Promise.all(Array.from({length:16},()=>tokens.reserveIv(makeReservation())));assert.equal(new Set(reservations.map(r=>r.iv)).size,16);
 const ts=Date.now(),iv=randomBytes(12),p={token:'integration_fake_token',expiresAt:ts+300000,ts,nonce:randomUUID()},cipher=createCipheriv('aes-256-gcm',Buffer.from(c.key,'base64url'),iv);
 const e={ciphertext:Buffer.concat([cipher.update(JSON.stringify(p)),cipher.final(),cipher.getAuthTag()]).toString('base64url'),iv:iv.toString('base64url'),ts};e.signature=sign('RSA-SHA256',Buffer.from(e.ciphertext+e.iv+e.ts),c.privateKey).toString('base64url');
 const results=await Promise.allSettled(Array.from({length:16},()=>tokens.accept(e)));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);await assert.rejects(new AppsScriptTokens(db,settings).accept(e));
 const persisted=await db.mailerStates.findOne({key:'appsscript'}).lean();assert(!JSON.stringify(persisted).includes(p.token));assert(!persisted.privateKey);assert.equal(await tokens.accessToken(),p.token);
 const indexes=await db.mailerNonces.collection.indexes();assert(indexes.some(i=>i.unique&&i.key.keyId===1&&i.key.nonce===1));
 const status=await request('/admin/mailer/appsscript/status','GET',undefined,'admin');assert.equal(status.headers.get('cache-control'),'no-store');assert.equal((await status.json()).tokenValid,true);
 assert.equal((await settings.get()).mailer.appsscriptMode,undefined);assert.equal((await settings.get()).mailer.provider,'appsscript');
 await tokens.generate(true);await assert.rejects(tokens.accessToken());await assert.rejects(tokens.accept(e));await assert.rejects(tokens.reserveIv(makeReservation()));
 }finally{await db.connection.dropDatabase();await app.close();}
});
