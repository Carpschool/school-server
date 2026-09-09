import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Negotiation,
  NegotiationSchema,
} from './schemas/negotiation.schema';
import {
  RiderApplication,
  RiderApplicationSchema,
} from '../applications/schemas/rider-application.schema';
import { LocalUser, LocalUserSchema } from '../auth/schemas/local-user.schema';
import { Carpool, CarpoolSchema } from '../carpools/schemas/carpool.schema';
import { NegotiationService } from './negotiation.service';
import { NegotiationController } from './negotiation.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Negotiation.name, schema: NegotiationSchema },
      { name: RiderApplication.name, schema: RiderApplicationSchema },
      { name: LocalUser.name, schema: LocalUserSchema },
      { name: Carpool.name, schema: CarpoolSchema },
    ]),
  ],
  controllers: [NegotiationController],
  providers: [NegotiationService],
  exports: [NegotiationService],
})
export class NegotiationModule {}
