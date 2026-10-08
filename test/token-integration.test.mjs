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
 const reservation=makeReservation(),allocated=await tokens.reserveIv(reservation);const ts=reservation.ts,iv=Buffer.from(allocated.iv,'base64url'),p={token:'integration_fake_token',expiresAt:ts+300000,ts,nonce:reservation.nonce},cipher=createCipheriv('aes-256-gcm',Buffer.from(c.key,'base64url'),iv);
 const e={ciphertext:Buffer.concat([cipher.update(JSON.stringify(p)),cipher.final(),cipher.getAuthTag()]).toString('base64url'),iv:iv.toString('base64url'),ts};e.signature=sign('RSA-SHA256',Buffer.from(e.ciphertext+e.iv+e.ts),c.privateKey).toString('base64url');
 const results=await Promise.allSettled(Array.from({length:16},()=>tokens.accept(e)));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);await assert.rejects(new AppsScriptTokens(db,settings).accept(e));
 const persisted=await db.mailerStates.findOne({key:'appsscript'}).lean();assert(!JSON.stringify(persisted).includes(p.token));assert(!persisted.privateKey);assert.equal(await tokens.accessToken(),p.token);
 const indexes=await db.mailerNonces.collection.indexes();assert(indexes.some(i=>i.unique&&i.key.keyId===1&&i.key.nonce===1));
 const status=await request('/admin/mailer/appsscript/status','GET',undefined,'admin');assert.equal(status.headers.get('cache-control'),'no-store');assert.equal((await status.json()).tokenValid,true);
 assert.equal((await settings.get()).mailer.appsscriptMode,undefined);assert.equal((await settings.get()).mailer.provider,'appsscript');
 await tokens.generate(true);await assert.rejects(tokens.accessToken());await assert.rejects(tokens.accept(e));await assert.rejects(tokens.reserveIv(makeReservation()));
 }finally{await db.connection.dropDatabase();await app.close();}
});
test('school Google broker guards, session-bound encrypted callback, refresh and disconnect',async t=>{
 const {GoogleMailer}=await import('../dist/google-mailer.js'),{Auth}=await import('../dist/security.js'),{schoolPublicKey}=await import('../dist/config.js'),{generateKeyPairSync,createPublicKey}=await import('node:crypto'),{SignJWT,EncryptJWT,jwtVerify,jwtDecrypt,exportJWK,createLocalJWKSet}=await import('jose');
 const app=await NestFactory.create(AppModule,{logger:false});await app.listen(0,'127.0.0.1');const db=app.get(Database),settings=app.get(SettingsService),google=app.get(GoogleMailer),auth=app.get(Auth),url=await app.getUrl(),central=generateKeyPairSync('ed25519'),brokerEncryption=generateKeyPairSync('rsa',{modulusLength:2048});
 const jwk=await exportJWK(central.publicKey);auth.local=createLocalJWKSet({keys:[{...jwk,alg:'EdDSA',kid:'test'}]});
 const assertion=async(claims,audience='sss')=>({assertion:await new SignJWT({...claims,purpose:'gmail-broker'}).setProtectedHeader({alg:'EdDSA',kid:'test'}).setIssuer('https://central.test').setAudience(audience).setIssuedAt().setExpirationTime('5m').setJti(randomUUID()).sign(central.privateKey)});
 const bundle=async p=>assertion({encrypted:await new EncryptJWT(p).setProtectedHeader({alg:'RSA-OAEP-256',enc:'A256GCM'}).setIssuer('https://central.test').setAudience('sss').setIssuedAt().setExpirationTime('5m').setJti(randomUUID()).encrypt(createPublicKey(google.publicKey()))});
 const nativeFetch=globalThis.fetch;
 try{
 await settings.write({configured:true,schoolCode:'sss',centralUrl:'https://central.test',publicUrl:'https://school.test',corsOrigins:['https://web.test'],mailer:{provider:'appsscript',url:'https://script.google.com/macros/s/interim/exec',secret:'interim-secret',fromName:'School'}});
 await db.users.create({sub:'admin'});await db.sessions.create({hash:digest('admin-session'),sub:'admin',schoolAdmin:true,expiresAt:new Date(Date.now()+600000)});
 for(const path of ['/admin/mailer/google/status','/admin/mailer/google/connect','/admin/mailer/google/disconnect'])assert.equal((await nativeFetch(url+path,{method:path.endsWith('status')?'GET':'POST'})).status,401);
 await assert.rejects(settings.update({mailer:{provider:'google'}}));
 let connectId,refreshCalls=0,revokeCalls=0,revokeFail=false;
 t.mock.method(globalThis,'fetch',async(input,init)=>{
  if(String(input).startsWith(url))return nativeFetch(input,init);
  if(String(input)==='https://central.test/mailer/google/key')return Response.json(await assertion({publicKey:brokerEncryption.publicKey.export({format:'pem',type:'spki'})},'carpschool-gmail-broker'));
  const body=JSON.parse(init.body),p=(await jwtVerify(body.assertion,createPublicKey(schoolPublicKey()),{algorithms:['EdDSA'],issuer:'sss',audience:'https://central.test'})).payload;
  if(String(input)==='https://central.test/mailer/google/connect'){assert.equal(p.returnOrigin,'https://web.test');connectId=p.connectId;return Response.json({url:'https://central.test/mailer/google/start?ticket=test'});}
  if(String(input)==='https://central.test/mailer/google/revoke'){revokeCalls++;assert.equal(p.action,'revoke');const decrypted=(await jwtDecrypt(p.encrypted,brokerEncryption.privateKey,{keyManagementAlgorithms:['RSA-OAEP-256'],contentEncryptionAlgorithms:['A256GCM'],issuer:'sss',audience:'https://central.test'})).payload;assert.equal(decrypted.refreshToken,'fake_google_refresh_token');assert.equal(decrypted.requestId,p.jti);if(revokeFail)return Response.json({error:'secret must not escape'},{status:503});return Response.json(await assertion({requestId:p.jti,revoked:true}));}
  assert.equal(String(input),'https://central.test/mailer/google/refresh');refreshCalls++;const decrypted=(await jwtDecrypt(p.encrypted,brokerEncryption.privateKey,{keyManagementAlgorithms:['RSA-OAEP-256'],contentEncryptionAlgorithms:['A256GCM'],issuer:'sss',audience:'https://central.test'})).payload;assert.equal(decrypted.refreshToken,'fake_google_refresh_token');assert.equal(decrypted.requestId,p.jti);
  return Response.json(await bundle({requestId:p.jti,accessToken:'fake_google_refreshed_token',expiresAt:Date.now()+300000}));
 });
 const req={identity:{sub:'admin'},headers:{authorization:'Bearer admin-session',origin:'https://web.test'}};await google.connect(req);assert(connectId);assert.equal((await settings.get()).mailer.provider,'appsscript');
 const b=await bundle({connectId,accessToken:'fake_google_access_token',refreshToken:'fake_google_refresh_token',email:'sender@test.edu',expiresAt:Date.now()+300000});await google.callback(b);await assert.rejects(google.callback(b));
 assert.equal((await google.status()).connected,true);const state=await db.mailerStates.findOne({key:'google'}).lean();assert(!JSON.stringify(state).includes('fake_google'));await settings.update({mailer:{provider:'google'}});assert.equal((await settings.view()).mailer.configured,true);assert.equal(await google.email(),'sender@test.edu');assert.equal(await google.accessToken(),'fake_google_access_token');
 await db.mailerStates.updateOne({key:'google'},{$set:{expiresAt:new Date(Date.now()-1000)}});assert.equal(await google.accessToken(),'fake_google_refreshed_token');assert.equal(refreshCalls,1);
 revokeFail=true;await assert.rejects(google.disconnect(),/Google mailer disconnect failed/);assert.equal((await google.status()).connected,true);revokeFail=false;await google.disconnect();assert.equal(revokeCalls,2);await google.disconnect();assert.equal(revokeCalls,2);assert.equal((await google.status()).connected,false);await assert.rejects(google.accessToken());
 await google.connect(req);await db.sessions.deleteOne({hash:digest('admin-session')});await assert.rejects(google.callback(await bundle({connectId,accessToken:'fake_google_access_token',refreshToken:'fake_google_refresh_token',email:'sender@test.edu',expiresAt:Date.now()+300000})));assert.equal((await google.status()).connected,false);
 }finally{await db.connection.dropDatabase();await app.close();}
});
