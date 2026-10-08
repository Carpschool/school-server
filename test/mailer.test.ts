import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Mailer, smtpOptions } from '../dist/mailer.js';
import { SettingsService, settingsPatch, validAppsScriptUrl } from '../dist/settings.js';
const url='https://script.google.com/macros/s/test-deployment_123/exec';
const relaySecret='unit-test-only-secret';
function settings(initial:any){
 let value=structuredClone(initial);
 const db:any={settings:{findOne:()=>({lean:async()=>({value})}),updateOne:async(_:any,update:any)=>{value=structuredClone(update.$set.value);}}};
 return new SettingsService(db);
}
function relay(config:any={provider:'appsscript',url,secret:relaySecret}){return new Mailer(settings({mailer:config}));}

test('Apps Script config allows only exact deployed Google HTTPS URLs',()=>{
 assert(settingsPatch.safeParse({mailer:{provider:'appsscript',url,secret:relaySecret}}).success);
 for(const bad of ['http://script.google.com/macros/s/x/exec','https://evil.test/macros/s/x/exec','https://script.google.com.evil.test/macros/s/x/exec','https://user@script.google.com/macros/s/x/exec','https://script.google.com:8443/macros/s/x/exec','https://script.google.com/macros/s/x/dev',url+'?next=http://127.0.0.1',url+'#fragment','https://script.google.com/macros/s/../exec','https://script.google.com/macros/s/%2F/exec',url+'/']){
  assert.equal(validAppsScriptUrl(bad),false,bad);
  assert.equal(settingsPatch.safeParse({mailer:{url:bad}}).success,false,bad);
 }
 assert.equal(settingsPatch.safeParse({mailer:{secret:''}}).success,false);
 assert(settingsPatch.safeParse({mailer:{secret:null}}).success);
});

test('Apps Script settings persist and keep secrets write-only',async()=>{
 const s=settings({mailer:{provider:'gmail',fromName:'School',clientSecret:'gmail-client',refreshToken:'gmail-refresh'}});
 const view=await s.update(settingsPatch.parse({mailer:{provider:'appsscript',url,secret:relaySecret}}));
 assert.equal(view.mailer.configured,true);assert.equal(view.mailer.secretSet,true);assert.equal(view.mailer.url,url);
 for(const hidden of [relaySecret,'gmail-client','gmail-refresh'])assert.equal(JSON.stringify(view).includes(hidden),false);
 assert.equal((await s.get()).mailer.secret,relaySecret);
 const unchanged=await s.update({mailer:{fromName:'New name'}});assert.equal(unchanged.mailer.secretSet,true);
 const cleared=await s.update(settingsPatch.parse({mailer:{secret:null}}));assert.equal(cleared.mailer.secretSet,false);assert.equal(cleared.mailer.configured,false);
});

test('configured status is provider-specific',async()=>{
 assert.equal((await settings({mailer:{provider:'appsscript',url}}).view()).mailer.configured,false);
 assert.equal((await settings({mailer:{provider:'appsscript',url:'https://evil.test',secret:relaySecret}}).view()).mailer.configured,false);
 assert.equal((await settings({mailer:{provider:'gmail',url,secret:relaySecret}}).view()).mailer.configured,false);
 assert.equal((await settings({mailer:{provider:'gmail',gmailUser:'sender@school.test',clientId:'client',clientSecret:'secret',refreshToken:'refresh'}}).view()).mailer.configured,true);
 assert.equal((await settings({mailer:{provider:'test'}}).view()).mailer.configured,true);
});

test('Apps Script posts JSON, follows response redirects and uses a deadline',async t=>{
 let calls=0;
 t.mock.method(globalThis,'fetch',async (input:any,init:any)=>{
  calls++;assert.equal(input,url);assert.equal(init.method,'POST');assert.equal(init.redirect,'follow');assert.deepEqual(init.headers,{'Content-Type':'application/json'});
  assert(init.signal instanceof AbortSignal);assert.equal(init.signal.aborted,false);
  assert.deepEqual(JSON.parse(init.body),{secret:relaySecret,to:'student@school.test',subject:'Code',text:'123456',html:'<p>123456</p>'});
  return Response.json({ok:true});
 });
 await relay().send('student@school.test','Code','123456','<p>123456</p>');assert.equal(calls,1);
});

test('plain text relay messages include empty optional HTML',async t=>{
 t.mock.method(globalThis,'fetch',async (_:any,init:any)=>{assert.equal(JSON.parse(init.body).html,'');return Response.json({ok:true});});
 await relay().send('student@school.test','Code','123456');
});

test('invalid or incomplete stored relay configuration never fetches',async t=>{
 t.mock.method(globalThis,'fetch',async()=>{assert.fail('must not fetch');});
 for(const config of [{provider:'appsscript',url},{provider:'appsscript',secret:relaySecret},{provider:'appsscript',url:'http://127.0.0.1/',secret:relaySecret}]){
  await assert.rejects(relay(config).send('x@school.test','Code','text'),/Mailer not configured/);
 }
});

test('HTTP, malformed JSON, rejected JSON, network and timeout failures are sanitized without retries',async t=>{
 const failures=[()=>new Response(relaySecret,{status:403}),()=>new Response('<html>sign in '+relaySecret+'</html>'),()=>Response.json({ok:false,error:relaySecret}),()=>Response.json({ok:'true'}),()=>Response.json(null),()=>Response.json({}),()=>{throw new Error(relaySecret);},()=>{throw new DOMException(relaySecret,'TimeoutError');}];
 for(const failure of failures){
  let calls=0;const mock=t.mock.method(globalThis,'fetch',async()=>{calls++;return failure();});
  await assert.rejects(relay().send('x@school.test','Code','text'),(e:any)=>{assert.equal(e.getStatus(),503);assert.equal(e.message,'Email delivery failed. Try again later.');assert.equal(JSON.stringify(e).includes(relaySecret),false);return true;});
  assert.equal(calls,1);mock.mock.restore();
 }
});

test('response read failures share the sanitized delivery error',async t=>{
 t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>{throw new DOMException(relaySecret,'AbortError');}}));
 await assert.rejects(relay().send('x@school.test','Code','text'),/Email delivery failed/);
});

test('ride notification failure logs only fixed text',async t=>{
 const m=relay();let logged='';t.mock.method(globalThis,'fetch',async()=>{throw new Error(relaySecret);});
 t.mock.method(m.logger,'error',(message:any)=>{logged=message;});
 await m.notify('x@school.test','Ride','text');assert.equal(logged,'Ride notification delivery failed');
});

test('test provider remains local and does not call fetch',async t=>{
 t.mock.method(globalThis,'fetch',async()=>{assert.fail('must not fetch');});
 const m=relay({provider:'test'});await m.send('x@school.test','Code','text');
 assert.deepEqual(m.testMessages,[{to:'x@school.test',subject:'Code',text:'text'}]);
});

test('Apps Script deadline aborts an unresponsive fetch',async t=>{
 // Shorten the native timeout for this test, while asserting the production deadline.
 const nativeTimeout=AbortSignal.timeout.bind(AbortSignal);
 t.mock.method(AbortSignal,'timeout',(milliseconds:number)=>{assert.equal(milliseconds,15000);return nativeTimeout(10);});
 t.mock.method(globalThis,'fetch',async (_:any,init:any)=>new Promise((_,reject)=>{
  // Keep the test event loop alive; native timeout timers are intentionally unref'd.
  const keepAlive=setTimeout(()=>reject(new Error('test hung')),1000);
  init.signal.addEventListener('abort',()=>{clearTimeout(keepAlive);reject(init.signal.reason);},{once:true});
 }));
 await assert.rejects(relay().send('x@school.test','Code','text'),/Email delivery failed/);
});

test('existing Gmail configuration now delivers through Gmail REST, never SMTP',async t=>{
 const config={provider:'gmail',gmailUser:'sender@school.test',clientId:'client',clientSecret:'secret',refreshToken:'refresh',fromName:'School'};
 let calls=0;t.mock.method(globalThis,'fetch',async(input:any,init:any)=>{calls++;if(input==='https://oauth2.googleapis.com/token')return Response.json({access_token:'fake_access_token'});assert.equal(input,'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');assert.equal(init.headers.Authorization,'Bearer fake_access_token');return Response.json({id:'fake-message'});});
 await relay(config).send('x@school.test','Code','text','<p>text</p>');assert.equal(calls,2);
});


test('SMTP UI fields validate and redact; legacy settings get compatible aliases',async()=>{
 const m={provider:'smtp',fromName:'School',smtpHost:'smtp.test',smtpPort:587,smtpSecurity:'starttls',smtpUser:'sender',smtpPassword:'smtp-private',smtpFrom:'sender@test.edu'};
 const parsed=settingsPatch.parse({mailer:m});const s=settings({mailer:{}});const view=await s.update(parsed);assert.equal(view.mailer.configured,true);assert.equal(view.mailer.smtpFrom,m.smtpFrom);assert.equal(view.mailer.smtpPasswordSet,true);assert(!JSON.stringify(view).includes('smtp-private'));
 const old=await settings({mailer:{...m,smtpFrom:undefined,smtpSecurity:undefined,fromEmail:m.smtpFrom,smtpSecure:true}}).view();assert.equal(old.mailer.smtpFrom,m.smtpFrom);assert.equal(old.mailer.smtpSecurity,'tls');
 for(const bad of ['invalid','ssl',''])assert(!settingsPatch.safeParse({mailer:{smtpSecurity:bad}}).success);
});

test('SMTP transport TLS policy and restricted content access',()=>{
 for(const security of ['starttls','tls','none']){const o=smtpOptions({provider:'smtp',fromName:'School',smtpSecurity:security});assert.equal(o.secure,security==='tls');assert.equal(o.requireTLS,security==='starttls');assert.equal(o.ignoreTLS,security==='none');assert.equal(o.disableFileAccess,true);assert.equal(o.disableUrlAccess,true);assert.equal(o.connectionTimeout,15000);assert.equal(o.tls,undefined);}
 assert.equal(smtpOptions({provider:'smtp',fromName:'School'}).requireTLS,true);
 assert.equal(smtpOptions({provider:'smtp',fromName:'School',smtpSecure:true}).secure,true);
});

test('SMTP branch sends composed message and sanitizes errors without Gmail fetch',async t=>{
 const {createHash}=await import('node:crypto');const m={provider:'smtp',fromName:'School',smtpHost:'smtp.test',smtpPort:587,smtpSecurity:'starttls',smtpUser:'sender',smtpPassword:'smtp-private',smtpFrom:'sender@test.edu'};
 const mailer=relay(m);const key=createHash('sha256').update(JSON.stringify([m.smtpHost,m.smtpPort,m.smtpSecurity,m.smtpUser,m.smtpPassword])).digest('hex');let calls=0;mailer.transport={key,t:{sendMail:async(message:any)=>{calls++;assert.deepEqual(message.from,{name:'School',address:'sender@test.edu'});return {messageId:'test'};}} as any};
 t.mock.method(globalThis,'fetch',async()=>{assert.fail('SMTP must not fetch Gmail');});await mailer.send('recipient@test.edu','Code','text');assert.equal(calls,1);
 mailer.transport.t.sendMail=async()=>{throw new Error('smtp-private');};await assert.rejects(mailer.send('recipient@test.edu','Code','text'),(e:any)=>{assert.equal(e.message,'Email delivery failed. Try again later.');assert(!JSON.stringify(e).includes('smtp-private'));return true;});
 await assert.rejects(mailer.send('recipient@test.edu','Code\r\nBcc: evil@test.edu','text'));
});
