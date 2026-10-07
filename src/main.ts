import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.js';
import { loadConfig } from './config.js';
import { loadSigningKey, startHeartbeats } from './heartbeat.js';
async function main(){
 const c=loadConfig();
 const key=loadSigningKey(c.SIGNING_KEY_PATH);
 const app=await NestFactory.create(AppModule);
 app.use(helmet());
 app.enableCors({origin:c.CORS_ORIGINS.split(',').filter(Boolean),credentials:false});
 app.enableShutdownHooks();
 const document=SwaggerModule.createDocument(app,new DocumentBuilder().setTitle('Carpschool School API').setVersion('1.0.0').addBearerAuth().build());
 SwaggerModule.setup('docs',app,document,{jsonDocumentUrl:'/openapi.json'});
 await app.listen(c.PORT,process.env.HOST||'0.0.0.0');
 if(process.env.HEARTBEATS!=='off') startHeartbeats(c,key);
}
main().catch(error=>{console.error('School startup failed',error.message);process.exit(1);});
