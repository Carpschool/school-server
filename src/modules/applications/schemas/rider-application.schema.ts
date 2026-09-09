import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type RiderApplicationDocument = RiderApplication & Document;

export enum CommuteDirection {
  HOME_TO_SCHOOL = 'HOME_TO_SCHOOL',
  SCHOOL_TO_HOME = 'SCHOOL_TO_HOME',
}

export enum ScheduleType {
  ONE_TIME = 'ONE_TIME',
  RECURRING = 'RECURRING',
}

@Schema({ timestamps: true, collection: 'rider_applications' })
export class RiderApplication {
  @Prop({ type: Types.ObjectId, ref: 'LocalUser', required: true, index: true })
  riderId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'UserHome', required: true })
  homeId: Types.ObjectId;

  @Prop({ required: true, enum: CommuteDirection })
  direction: CommuteDirection;

  @Prop({ required: true, enum: ScheduleType })
  scheduleType: ScheduleType;

  @Prop({ default: null })
  targetDate?: string; // e.g. "2026-09-18" for ONE_TIME

  @Prop({ type: [String], default: [] })
  recurringDays?: string[]; // ["MONDAY", "WEDNESDAY", "FRIDAY"] for RECURRING

  @Prop({ required: true })
  targetTime: string; // e.g. "08:30" (desired arrival or departure time)

  @Prop({ required: true, min: 10, max: 200 })
  walkingRadiusMeters: number;

  @Prop({
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point',
    },
    coordinates: {
      type: [Number],
      required: true,
    },
  })
  pickupLocation: {
    type: string;
    coordinates: [number, number];
  };

  @Prop({ default: 'OPEN' })
  status: string; // 'OPEN', 'MATCHED', 'CANCELLED'

  @Prop({ default: '' })
  notes: string;
}

export const RiderApplicationSchema = SchemaFactory.createForClass(RiderApplication);
RiderApplicationSchema.index({ pickupLocation: '2dsphere' });
