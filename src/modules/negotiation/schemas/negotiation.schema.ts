import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { CommuteDirection } from '../../applications/schemas/rider-application.schema';

export type NegotiationDocument = Negotiation & Document;

export enum ProposalStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  DENIED = 'DENIED',
  SUPERSEDED = 'SUPERSEDED',
}

@Schema({ timestamps: true, collection: 'negotiations' })
export class Negotiation {
  @Prop({ type: Types.ObjectId, ref: 'LocalUser', required: true, index: true })
  driverId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'LocalUser', required: true, index: true })
  riderId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'RiderApplication', required: true })
  applicationId: Types.ObjectId;

  @Prop({ required: true, enum: CommuteDirection })
  direction: CommuteDirection;

  @Prop({ default: 'ACTIVE' })
  status: string; // 'ACTIVE', 'LOCKED', 'CANCELLED'

  @Prop({
    type: [
      {
        senderId: { type: Types.ObjectId, ref: 'LocalUser' },
        text: String,
        timestamp: { type: Date, default: Date.now },
      },
    ],
    default: [],
  })
  messages: Array<{
    senderId: Types.ObjectId;
    text: string;
    timestamp: Date;
  }>;

  @Prop({
    type: [
      {
        proposalId: String,
        proposedBy: { type: Types.ObjectId, ref: 'LocalUser' },
        pickupPointName: String,
        pickupCoordinates: {
          type: [Number], // [lng, lat]
          required: true,
        },
        proposedTime: String,
        status: { type: String, enum: Object.values(ProposalStatus), default: ProposalStatus.PENDING },
        timestamp: { type: Date, default: Date.now },
      },
    ],
    default: [],
  })
  proposals: Array<{
    proposalId: string;
    proposedBy: Types.ObjectId;
    pickupPointName: string;
    pickupCoordinates: [number, number];
    proposedTime: string;
    status: ProposalStatus;
    timestamp: Date;
  }>;
}

export const NegotiationSchema = SchemaFactory.createForClass(Negotiation);
