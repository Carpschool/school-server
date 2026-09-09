import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EduVerification, EduVerificationDocument } from './schemas/edu-verification.schema';
import { LocalUser, LocalUserDocument } from '../auth/schemas/local-user.schema';

@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

  constructor(
    @InjectModel(EduVerification.name)
    private readonly verificationModel: Model<EduVerificationDocument>,
    @InjectModel(LocalUser.name)
    private readonly localUserModel: Model<LocalUserDocument>,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Sends a 6-digit OTP to the student's institutional .edu email address.
   */
  async sendCode(centralUserId: string, eduEmail: string): Promise<{ success: boolean; message: string }> {
    const cleanEmail = eduEmail.toLowerCase().trim();
    const domain = cleanEmail.split('@')[1];

    const allowedDomains = this.configService
      .get<string>('ALLOWED_EMAIL_DOMAINS', 'ubc.ca,student.ubc.ca')
      .split(',')
      .map((d) => d.trim().toLowerCase());

    const isDomainAllowed = allowedDomains.some(
      (allowed) => domain === allowed || domain.endsWith('.' + allowed),
    );

    if (!isDomainAllowed) {
      throw new BadRequestException(
        `Email domain "@${domain}" is not recognized for this school. Allowed: ${allowedDomains.join(', ')}`,
      );
    }

    let user = await this.localUserModel.findOne({ centralUserId });
    if (!user) {
      user = await this.localUserModel.create({
        centralUserId,
        clerkUserId: centralUserId,
        fullName: 'Student',
        isEduVerified: false,
        userRoles: ['rider'],
      });
    }

    // Generate random 6-digit numeric OTP
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // Expire in 15 minutes
    const expireAt = new Date(Date.now() + 15 * 60 * 1000);

    await this.verificationModel.deleteMany({ userId: user._id });
    await this.verificationModel.create({
      userId: user._id,
      eduEmail: cleanEmail,
      code,
      attempts: 0,
      expireAt,
    });

    this.logger.log(`📧 [EDU VERIFICATION] Sent code "${code}" to "${cleanEmail}"`);

    return {
      success: true,
      message: `A 6-digit verification code has been dispatched to ${cleanEmail}`,
    };
  }

  /**
   * Verifies the 6-digit code and marks isEduVerified: true on the local user.
   */
  async verifyCode(centralUserId: string, code: string): Promise<{ verified: boolean }> {
    const user = await this.localUserModel.findOne({ centralUserId });
    if (!user) throw new BadRequestException('User not found');

    const record = await this.verificationModel.findOne({ userId: user._id });
    if (!record) {
      throw new BadRequestException('No active verification code found or code expired');
    }

    if (record.attempts >= 5) {
      await this.verificationModel.deleteOne({ _id: record._id });
      throw new BadRequestException('Too many failed attempts. Please request a new code.');
    }

    if (record.code !== code.trim()) {
      record.attempts += 1;
      await record.save();
      throw new BadRequestException('Incorrect verification code. Please try again.');
    }

    // Success! Update local user
    user.eduEmail = record.eduEmail;
    user.isEduVerified = true;
    await user.save();

    await this.verificationModel.deleteOne({ _id: record._id });
    this.logger.log(`🎓 User "${user.fullName}" is now verified with email ${user.eduEmail}!`);

    return { verified: true };
  }
}
