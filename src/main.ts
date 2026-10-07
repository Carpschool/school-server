import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.js';
import { loadConfig, schoolKey, otpPepper, dataDir } from './config.js';
import { startHeartbeats } from './heartbeat.js';
import { SettingsService } from './settings.js';
async function main(){
 const c=loadConfig();
 schoolKey();otpPepper(); // create/verify persistent secrets on the data volume before serving
 const app=await NestFactory.create(AppModule);
 const settings=app.get(SettingsService);
 app.use(helmet());
 // CORS origins are DB settings, re-read per request (cached 5s).
 app.enableCors((req:any,cb:any)=>{const o=req.headers.origin;if(!o)return cb(null,{origin:false});settings.get().then(s=>cb(null,{origin:s.corsOrigins.includes(o),credentials:false}),e=>cb(e));});
 app.enableShutdownHooks();
 const document=SwaggerModule.createDocument(app,new DocumentBuilder().setTitle('Carpschool School API').setVersion('1.0.0').addBearerAuth().build());
 SwaggerModule.setup('docs',app,document,{jsonDocumentUrl:'/openapi.json'});
 await app.listen(c.PORT,'0.0.0.0');
 console.log('Data volume '+dataDir());
 startHeartbeats(settings);
}
main().catch(error=>{console.error('School startup failed',error.message);process.exit(1);});
