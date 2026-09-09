import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

/**
 * NegotiationGateway
 * 
 * Manages real-time WebSocket communication for:
 * 1. Negotiation room chat and live proposal updates (Confirm / Deny / Suggest New).
 * 2. Carpool status broadcasts (Passenger Boarded, All Seats Filled, Trip Completed).
 */
@WebSocketGateway({
  cors: { origin: '*' },
})
export class NegotiationGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(NegotiationGateway.name);

  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join_negotiation')
  handleJoinNegotiation(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { negotiationId: string },
  ) {
    client.join(`negotiation:${data.negotiationId}`);
    this.logger.log(`Socket ${client.id} joined negotiation:${data.negotiationId}`);
  }

  @SubscribeMessage('leave_negotiation')
  handleLeaveNegotiation(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { negotiationId: string },
  ) {
    client.leave(`negotiation:${data.negotiationId}`);
  }

  /**
   * Broadcasts a new message or proposal card to the negotiation room
   */
  emitNegotiationUpdate(negotiationId: string, event: string, payload: any) {
    this.server.to(`negotiation:${negotiationId}`).emit(event, payload);
  }

  /**
   * Broadcasts carpool status change (e.g. seat filled, passenger boarded)
   */
  emitCarpoolUpdate(carpoolId: string, event: string, payload: any) {
    this.server.to(`carpool:${carpoolId}`).emit(event, payload);
  }
}
