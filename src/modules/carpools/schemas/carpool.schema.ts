import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { CommuteDirection } from '../../applications/schemas/rider-application.schema';

export type CarpoolDocument = Carpool & Document;

@Schema({ timestamps: true, collection: 'carpools' })
export class Carpool {
  @Prop({ type: Types.ObjectId, ref: 'LocalUser', required: true, index: true })
  driverId: Types.ObjectId;

  @Prop({ required: true, enum: CommuteDirection })
  direction: CommuteDirection;

  @Prop({ required: true })
  targetDate: string; // YYYY-MM-DD

  @Prop({ default: 'SCHEDULED' })
  status: string; // 'SCHEDULED', 'BOARDING', 'ACTIVE', 'COMPLETED', 'CANCELLED'

  @Prop({ required: true, default: 3 })
  totalSeatCapacity: number;

  @Prop({ required: true, default: 3 })
  availableSeats: number;

  @Prop({
    type: [
      {
        riderId: { type: Types.ObjectId, ref: 'LocalUser' },
        applicationId: { type: Types.ObjectId, ref: 'RiderApplication' },
        pickupPointName: String,
        pickupCoordinates: [Number], // [lng, lat]
        agreedPickupTime: String,
        boardingSafetyPin: String, // 4-digit PIN e.g. "4819"
        status: { type: String, default: 'CONFIRMED' }, // 'CONFIRMED', 'BOARDED', 'CANCELLED'
        boardingTimestamp: { type: Date, default: null },
        boardingCoordinates: { type: [Number], default: null }, // SINGLE GPS READ
      },
    ],
    default: [],
  })
  passengers: Array<{
    riderId: Types.ObjectId;
    applicationId: Types.ObjectId;
    pickupPointName: string;
    pickupCoordinates: [number, number];
    agreedPickupTime: string;
    boardingSafetyPin: string;
    status: string;
    boardingTimestamp?: Date;
    boardingCoordinates?: [number, number];
  }>;

  @Prop({ default: null })
  endRideTimestamp?: Date;

  @Prop({ type: [Number], default: null })
  endRideCoordinates?: [number, number]; // SINGLE GPS READ AT DESTINATION
}

export const CarpoolSchema = SchemaFactory.createForClass(Carpool);
