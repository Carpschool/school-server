import {createHash} from 'node:crypto';
import {aesBundle,scriptTemplate} from './generated/appsscript-aes.js';
export function generateScript(v:{endpoint:string;aesKey:Buffer;rsaPrivateKey:string;keyId:string}){
 if(!aesBundle)throw new Error('Apps Script AES bundle missing');
 const prefix=createHash('sha256').update(v.keyId).digest('hex').slice(0,16);
 const config=JSON.stringify({endpoint:v.endpoint,key:v.aesKey.toString('base64url'),privateKey:v.rsaPrivateKey,keyId:v.keyId,prefix});
 const codeGs='// @noble/ciphers MIT copyright Paul Miller, Thomas Pornin. Keep this script private.\n'+aesBundle+scriptTemplate.replace('__CS_CONFIG__',()=>config);
 const appsscriptJson=JSON.stringify({timeZone:'America/Vancouver',runtimeVersion:'V8',exceptionLogging:'NONE',oauthScopes:['https://www.googleapis.com/auth/gmail.send','https://www.googleapis.com/auth/script.external_request','https://www.googleapis.com/auth/script.scriptapp']});
 return {codeGs,appsscriptJson};
}
