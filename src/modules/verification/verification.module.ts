import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  EduVerification,
  EduVerificationSchema,
} from './schemas/edu-verification.schema';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../email/email.module';
import { VerificationService } from './verification.service';
import { VerificationController } from './verification.controller';

@Module({
  imports: [
    AuthModule,
    EmailModule,
    MongooseModule.forFeature([
      { name: EduVerification.name, schema: EduVerificationSchema },
    ]),
  ],
  controllers: [VerificationController],
  providers: [VerificationService],
  exports: [VerificationService],
})
export class VerificationModule {}
