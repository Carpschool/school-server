import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type EduVerificationDocument = EduVerification & Document;

@Schema({ timestamps: true, collection: 'edu_verification_codes' })
export class EduVerification {
  @Prop({ type: Types.ObjectId, ref: 'LocalUser', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  eduEmail: string;

  @Prop({ required: true })
  code: string; // 6-digit OTP

  @Prop({ default: 0 })
  attempts: number;

  @Prop({ required: true, expires: '15m' })
  expireAt: Date; // TTL index: auto deleted after 15 minutes
}

export const EduVerificationSchema = SchemaFactory.createForClass(EduVerification);
