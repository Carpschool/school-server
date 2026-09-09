import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type UserHomeDocument = UserHome & Document;

/**
 * Saved home/dorm/pickup location for a student with a custom walking radius.
 */
@Schema({ timestamps: true, collection: 'user_homes' })
export class UserHome {
  @Prop({ type: Types.ObjectId, ref: 'LocalUser', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  label: string; // e.g. "Primary Residence", "Campus Dorm", "Parent's House"

  @Prop({ required: true })
  address: string;

  @Prop({
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point',
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      required: true,
    },
  })
  location: {
    type: string;
    coordinates: [number, number];
  };

  @Prop({ required: true, min: 10, max: 200, default: 50 })
  walkingRadiusMeters: number; // 10m to 200m walking radius chosen by user

  @Prop({ default: false })
  isDefault: boolean;
}

export const UserHomeSchema = SchemaFactory.createForClass(UserHome);
UserHomeSchema.index({ location: '2dsphere' });
