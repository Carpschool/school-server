import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LocalUser, LocalUserDocument } from './schemas/local-user.schema';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectModel(LocalUser.name)
    private readonly localUserModel: Model<LocalUserDocument>,
  ) {}

  /**
   * Upserts the local user profile upon presenting a verified Central Server ticket.
   */
  async getOrCreateLocalUser(userClaims: {
    centralUserId: string;
    clerkUserId: string;
    fullName: string;
  }): Promise<LocalUser> {
    return this.localUserModel.findOneAndUpdate(
      { centralUserId: userClaims.centralUserId },
      {
        $setOnInsert: {
          centralUserId: userClaims.centralUserId,
          clerkUserId: userClaims.clerkUserId,
          fullName: userClaims.fullName,
          isEduVerified: false,
          userRoles: ['rider'],
        },
      },
      { upsert: true, new: true },
    );
  }

  async getProfile(centralUserId: string): Promise<LocalUser | null> {
    return this.localUserModel.findOne({ centralUserId }).exec();
  }
}
