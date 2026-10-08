import {build} from 'esbuild';
import {writeFileSync,mkdirSync,readFileSync} from 'node:fs';
const r=await build({entryPoints:['scripts/appsscript-entry.js'],bundle:true,minify:true,format:'iife',globalName:'CS_AES',platform:'neutral',target:'es2020',write:false});
const t=await build({stdin:{contents:readFileSync('scripts/appsscript-template.js','utf8'),loader:'js'},minifyWhitespace:true,minifySyntax:true,minifyIdentifiers:false,target:'es2020',write:false});
mkdirSync('src/generated',{recursive:true});
writeFileSync('src/generated/appsscript-aes.ts','// @noble/ciphers MIT. Generated.'+String.fromCharCode(10)+'export const aesBundle = '+JSON.stringify(r.outputFiles[0].text)+';'+String.fromCharCode(10)+'export const scriptTemplate = '+JSON.stringify(t.outputFiles[0].text)+';');
