import 'reflect-metadata';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, verify, createPublicKey } from 'node:crypto';
import { SignJWT, exportJWK, createLocalJWKSet } from 'jose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { AppModule } from '../dist/app.js';
import { setDataDir, schoolKey, otpPepper } from '../dist/config.js';
import { SetupService } from '../dist/setup.js';
import { SettingsService } from '../dist/settings.js';
let mongo:any, app:any, setup:any, settings:any;
const temp=mkdtempSync(join(tmpdir(),'carpschool-setup-'));
const central=generateKeyPairSync('ed25519');let jwks:any;
const ISS='https://central.test';
const assertion=(nonce:string,extra:any={},key=central.privateKey,iss=ISS)=>new SignJWT({schoolCode:'kjt',publicUrl:'https://school.test',nonce,...extra}).setProtectedHeader({alg:'EdDSA',kid:'c'}).setIssuer(iss).setAudience('carpschool-setup').setIssuedAt().setExpirationTime('5m').sign(key);
const H=()=>request(app.getHttpServer());
before(async()=>{
 mongo=await MongoMemoryReplSet.create({replSet:{count:1}});
 Object.assign(process.env,{NODE_ENV:'test',MONGO_URI:mongo.getUri()});setDataDir(join(temp,'data'));
 jwks=createLocalJWKSet({keys:[{...await exportJWK(central.publicKey),kid:'c',alg:'EdDSA'}]});
 app=await NestFactory.create(AppModule,{logger:false});await app.listen(0,'127.0.0.1');
 setup=app.get(SetupService);settings=app.get(SettingsService);
},{timeout:120000});
after(async()=>{await app?.close();await mongo?.stop();rmSync(temp,{recursive:true,force:true});});
test('setup code: 7 hex chars, signing key + pepper persisted on the data volume',()=>{
 schoolKey();otpPepper();
 assert.match(setup.code,/^[0-9a-f]{7}$/);
 assert.match(readFileSync(join(temp,'data/signing.pem'),'utf8'),/PRIVATE KEY/);
 assert.ok(readFileSync(join(temp,'data/otp-pepper'),'utf8').length>20);
});
test('unconfigured school serves only /health and /setup/claim',async()=>{
 const h=await H().get('/health').expect(200);assert.equal(h.body.configured,false);
 for(const p of ['/.well-known/carpschool.json','/me','/admin/settings','/federation/challenge?nonce=aaaaaaaaaaaaaaaaaaaa'])await H().get(p).expect(503);
 await H().post('/sessions').send({ticket:'x'.repeat(30)}).expect(503);
});
test('bad codes lock the claim and rotate the code',async()=>{
 const first=setup.code;const nonce='n'.repeat(20);
 for(let i=0;i<5;i++)await assert.rejects(setup.claim({code:'0000000'===first?'1111111':'0000000',assertion:await assertion(nonce),nonce},jwks),/Invalid setup code/);
 assert.notEqual(setup.code,first,'rotated');
 await assert.rejects(setup.claim({code:setup.code,assertion:await assertion(nonce),nonce},jwks),/locked/);
 setup.lockedUntil=0;setup.window={start:0,n:0};
});
test('claim rejects forged / wrong-nonce / wrong-audience assertions without burning the code',async()=>{
 const nonce='m'.repeat(20);const attacker=generateKeyPairSync('ed25519');
 await assert.rejects(setup.claim({code:setup.code,assertion:await assertion(nonce,{},attacker.privateKey),nonce},jwks),/rejected/);
 await assert.rejects(setup.claim({code:setup.code,assertion:await assertion('x'.repeat(20)),nonce},jwks),/claims/);
 await assert.rejects(setup.claim({code:setup.code,assertion:await assertion(nonce,{},central.privateKey,'http://evil.example'),nonce},jwks),/HTTPS/);
 assert.ok(setup.code);assert.equal((await settings.get()).configured,false);
 setup.window={start:0,n:0};
});
test('valid claim pins central, returns signed nonce, destroys the code; second claim fails',async()=>{
 const nonce='k'.repeat(24);const code=setup.code;
 const r=await setup.claim({code:code.toUpperCase(),assertion:await assertion(nonce),nonce},jwks);
 assert.equal(r.schoolCode,'kjt');assert.ok(verify(null,Buffer.from(nonce),createPublicKey(r.publicKey),Buffer.from(r.signature,'base64url')));
 const s=await settings.get();assert.equal(s.configured,true);assert.equal(s.centralUrl,ISS);assert.equal(s.publicUrl,'https://school.test');
 assert.equal(setup.code,undefined);
 await assert.rejects(setup.claim({code,assertion:await assertion(nonce),nonce},jwks),/already/);
 await H().post('/setup/claim').send({code,assertion:'x'.repeat(30),nonce}).expect(409);
 await H().get('/.well-known/carpschool.json').expect(200);
});
