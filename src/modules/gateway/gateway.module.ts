import { Global, Module } from '@nestjs/common';
import { NegotiationGateway } from './negotiation.gateway';

@Global()
@Module({
  providers: [NegotiationGateway],
  exports: [NegotiationGateway],
})
export class GatewayModule {}
