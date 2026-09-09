import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type LocalUserDocument = LocalUser & Document;

/**
 * Local student profile stored in School Server database (school_db).
 */
@Schema({ timestamps: true, collection: 'local_users' })
export class LocalUser {
  @Prop({ required: true, unique: true, index: true })
  centralUserId: string;

  @Prop({ required: true, index: true })
  clerkUserId: string;

  @Prop({ required: true })
  fullName: string;

  @Prop({ default: null, sparse: true })
  eduEmail?: string;

  @Prop({ default: false })
  isEduVerified: boolean;

  /**
   * Personal email address for drivers (e.g. personal Gmail/Outlook/etc.).
   * Required for drivers along with a verified school eduEmail.
   */
  @Prop({ default: null, sparse: true })
  personalEmail?: string;

  /**
   * Exclusive single role: an account can only be a 'rider' or 'driver'.
   */
  @Prop({ type: String, enum: ['rider', 'driver'], default: null })
  role?: 'rider' | 'driver';

  /**
   * Flag indicating whether the student completed the onboarding flow.
   */
  @Prop({ default: false })
  isOnboarded: boolean;

  @Prop({ type: [String], default: ['rider'] })
  userRoles: string[]; // 'rider', 'driver', 'admin'

  @Prop({
    type: {
      make: String,
      model: String,
      color: String,
      licensePlate: String,
      totalSeatCapacity: Number,
    },
    default: null,
  })
  vehicle?: {
    make: string;
    model: string;
    color: string;
    licensePlate: string;
    totalSeatCapacity: number;
  };

  @Prop({ default: 5.0 })
  ratingAverage: number;

  @Prop({ default: 0 })
  ratingCount: number;
}

export const LocalUserSchema = SchemaFactory.createForClass(LocalUser);
