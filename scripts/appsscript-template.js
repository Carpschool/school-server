var CS_CONFIG=__CS_CONFIG__;
function csBytes(a){return new Uint8Array(a.map(function(x){return x&255;}));}
function csSigned(a){return Array.from(a,function(x){return x>127?x-256:x;});}
function csB64(a){return Utilities.base64EncodeWebSafe(csSigned(a)).replace(/=+$/,'');}
function csUtf8(s){return csBytes(Utilities.newBlob(s).getBytes());}
function pushToken(){
 var lock=LockService.getScriptLock();lock.waitLock(30000);
 try{
  var token=ScriptApp.getOAuthToken();
  var infoResponse=UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?access_token='+encodeURIComponent(token),{muteHttpExceptions:true});
  if(infoResponse.getResponseCode()!==200)throw new Error('Token check failed');
  var info=JSON.parse(infoResponse.getContentText());
  if(String(info.scope||'').split(' ').indexOf('https://www.googleapis.com/auth/gmail.send')<0)throw new Error('Scope missing');
  var seconds=Number(info.expires_in);if(!Number.isFinite(seconds)||seconds<120)throw new Error('Token too short');
  var ts=Date.now(),expiresAt=ts+Math.floor(Math.min(seconds-60,3000))*1000;
  var reservationNonce=Utilities.getUuid().toLowerCase();
  var reservationMessage='carpschool-appsscript-iv:'+CS_CONFIG.keyId+':'+ts+':'+reservationNonce;
  var reservationSignature=csB64(csBytes(Utilities.computeRsaSha256Signature(reservationMessage,CS_CONFIG.privateKey,Utilities.Charset.UTF_8)));
  var reserved=UrlFetchApp.fetch(CS_CONFIG.endpoint.replace(/\/token$/,'/iv'),{method:'post',contentType:'application/json',payload:JSON.stringify({keyId:CS_CONFIG.keyId,ts:ts,nonce:reservationNonce,signature:reservationSignature}),muteHttpExceptions:true,followRedirects:false});
  if(reserved.getResponseCode()!==201&&reserved.getResponseCode()!==200)throw new Error('Reservation failed');
  var ivEncoded=JSON.parse(reserved.getContentText()).iv;
  if(typeof ivEncoded!=='string'||!/^[A-Za-z0-9_-]{16}$/.test(ivEncoded))throw new Error('Invalid reservation');
  var iv=csBytes(Utilities.base64DecodeWebSafe(ivEncoded));
  var key=csBytes(Utilities.base64DecodeWebSafe(CS_CONFIG.key));
  var data=csUtf8(JSON.stringify({token:token,expiresAt:expiresAt,ts:ts,nonce:reservationNonce}));
  var ciphertext=csB64(CS_AES.encrypt(key,iv,data));
  var signature=csB64(csBytes(Utilities.computeRsaSha256Signature(ciphertext+ivEncoded+String(ts),CS_CONFIG.privateKey,Utilities.Charset.UTF_8)));
  var response=UrlFetchApp.fetch(CS_CONFIG.endpoint,{method:'post',contentType:'application/json',payload:JSON.stringify({ciphertext:ciphertext,iv:ivEncoded,ts:ts,signature:signature}),muteHttpExceptions:true,followRedirects:false});
  if(response.getResponseCode()<200||response.getResponseCode()>=300||JSON.parse(response.getContentText()).ok!==true)throw new Error('Push failed');
 }catch(e){throw new Error('CarpSchool token push failed. Check permissions and regenerate if needed.');}finally{lock.releaseLock();}
}
function setup(){
 var lock=LockService.getScriptLock();lock.waitLock(30000);
 try{ScriptApp.getProjectTriggers().forEach(function(t){if(t.getHandlerFunction()==='pushToken')ScriptApp.deleteTrigger(t);});ScriptApp.newTrigger('pushToken').timeBased().everyMinutes(30).create();}finally{lock.releaseLock();}
 pushToken();
}
