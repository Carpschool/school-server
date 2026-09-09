import { Injectable, Logger, BadRequestException } from '@nestjs/common';
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
          role: null,
          isOnboarded: false,
          userRoles: ['rider'],
        },
      },
      { upsert: true, new: true },
    );
  }

  async getProfile(centralUserId: string): Promise<LocalUser | null> {
    return this.localUserModel.findOne({ centralUserId }).exec();
  }

  /**
   * Updates local student profile (role, isOnboarded, personalEmail, vehicle).
   */
  async updateProfile(
    centralUserId: string,
    dto: {
      role?: 'rider' | 'driver';
      isOnboarded?: boolean;
      personalEmail?: string;
      userRoles?: string[];
      vehicle?: {
        make: string;
        model: string;
        color: string;
        licensePlate: string;
        totalSeatCapacity: number;
      };
    },
  ): Promise<LocalUser> {
    const update: any = {};
    if (dto.role !== undefined) {
      if (dto.role !== 'rider' && dto.role !== 'driver') {
        throw new BadRequestException('Role must be either "rider" or "driver"');
      }
      update.role = dto.role;
      update.userRoles = [dto.role];
    }
    if (dto.isOnboarded !== undefined) {
      update.isOnboarded = Boolean(dto.isOnboarded);
    }
    if (dto.personalEmail !== undefined) {
      update.personalEmail = dto.personalEmail ? dto.personalEmail.trim().toLowerCase() : null;
    }
    if (dto.userRoles !== undefined && dto.role === undefined) {
      update.userRoles = dto.userRoles;
      if (dto.userRoles.includes('driver')) {
        update.role = 'driver';
      } else if (dto.userRoles.includes('rider')) {
        update.role = 'rider';
      }
    }
    if (dto.vehicle !== undefined) {
      update.vehicle = dto.vehicle;
    }

    const updated = await this.localUserModel.findOneAndUpdate(
      { centralUserId },
      { $set: update },
      { new: true },
    );
    if (!updated) {
      throw new Error('User profile not found');
    }
    return updated;
  }
}
