import { WebSocketGateway, WebSocketServer, SubscribeMessage, ConnectedSocket, MessageBody, WsException, OnGatewayConnection, OnGatewayInit } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { Auth } from './security.js';
import { SchoolService } from './school.service.js';
import { parse, idSchema, proposalSchema } from './validation.js';
import { SettingsService } from './settings.js';
let corsSource:SettingsService|undefined;
const room=z.object({negotiationId:idSchema}).strict();
@WebSocketGateway({cors:{origin:(origin:string,cb:any)=>{if(!origin)return cb(null,true);if(!corsSource)return cb(null,false);corsSource.get().then(s=>cb(null,s.corsOrigins.includes(origin)),()=>cb(null,false));},credentials:false},maxHttpBufferSize:20000})
export class ChatGateway implements OnGatewayConnection, OnGatewayInit {
 @WebSocketServer() server!:Server;
 constructor(readonly auth:Auth,readonly service:SchoolService){corsSource=service.settings;}
 afterInit(server:Server){server.use(async(socket,next)=>{try{const token=socket.handshake.auth?.token;if(typeof token!=='string')throw new Error();const identity=await this.auth.authenticate(token);socket.data.token=token;socket.data.identity=identity;next();}catch{next(new Error('Authentication required'));}});}
 handleConnection(socket:Socket){socket.data.expiryTimer=setTimeout(()=>socket.disconnect(true),Math.max(0,socket.data.identity.expiresAt.getTime()-Date.now()));socket.on('disconnect',()=>clearTimeout(socket.data.expiryTimer));}
 async identity(socket:Socket){try{return await this.auth.authenticate(socket.data.token);}catch{socket.disconnect(true);throw new WsException('Session expired');}}
 async safe<T>(fn:()=>Promise<T>){try{return {ok:true,data:await fn()};}catch(e:any){throw new WsException(e?.response?.message??'Request rejected');}}
 @SubscribeMessage('negotiation:join') join(@ConnectedSocket() socket:Socket,@MessageBody() b:unknown){return this.safe(async()=>{const i=await this.identity(socket);const v=parse(room,b);await this.service.participant(i.sub,v.negotiationId);await socket.join(v.negotiationId);return {joined:true};});}
 @SubscribeMessage('message:send') message(@ConnectedSocket() socket:Socket,@MessageBody() b:unknown){return this.safe(async()=>{const i=await this.identity(socket);const v=parse(room.extend({text:z.string().min(1).max(2000)}),b);const m=await this.service.message(i.sub,v.negotiationId,v.text);this.server.to(v.negotiationId).emit('message:new',m);return m;});}
 @SubscribeMessage('proposal:send') proposal(@ConnectedSocket() socket:Socket,@MessageBody() b:unknown){return this.safe(async()=>{const i=await this.identity(socket);const v=parse(proposalSchema.extend({negotiationId:idSchema}),b);const p=await this.service.propose(i.sub,v.negotiationId,{pickup:v.pickup,time:v.time});this.server.to(v.negotiationId).emit('proposal:new',p);return p;});}
 @SubscribeMessage('proposal:accept') accept(@ConnectedSocket() socket:Socket,@MessageBody() b:unknown){return this.safe(async()=>{const i=await this.identity(socket);const v=parse(room.extend({proposalId:idSchema}),b);const p=await this.service.accept(i.sub,v.negotiationId,v.proposalId);this.server.to(v.negotiationId).emit('carpool:locked',{driveId:p.driveId,negotiationId:p.negotiationId});return p;});}
}
