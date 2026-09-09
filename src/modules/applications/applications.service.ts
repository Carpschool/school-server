import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  RiderApplication,
  RiderApplicationDocument,
} from './schemas/rider-application.schema';
import { LocalUser, LocalUserDocument } from '../auth/schemas/local-user.schema';
import { UserHome, UserHomeDocument } from '../homes/schemas/user-home.schema';
import { CreateApplicationDto } from './dto/create-application.dto';

@Injectable()
export class ApplicationsService {
  constructor(
    @InjectModel(RiderApplication.name)
    private readonly appModel: Model<RiderApplicationDocument>,
    @InjectModel(LocalUser.name)
    private readonly userModel: Model<LocalUserDocument>,
    @InjectModel(UserHome.name)
    private readonly homeModel: Model<UserHomeDocument>,
  ) {}

  async createApplication(
    centralUserId: string,
    dto: CreateApplicationDto,
  ): Promise<RiderApplication> {
    const user = await this.userModel.findOne({ centralUserId });
    if (!user) throw new BadRequestException('User not found');
    if (!user.isEduVerified) {
      throw new BadRequestException('You must verify your .edu email before posting a carpool application');
    }

    const home = await this.homeModel.findOne({ _id: dto.homeId, userId: user._id });
    if (!home) throw new NotFoundException('Selected home location not found');

    return this.appModel.create({
      riderId: user._id,
      homeId: home._id,
      direction: dto.direction,
      scheduleType: dto.scheduleType,
      targetDate: dto.targetDate || null,
      recurringDays: dto.recurringDays || [],
      targetTime: dto.targetTime,
      walkingRadiusMeters: home.walkingRadiusMeters,
      pickupLocation: home.location,
      status: 'OPEN',
      notes: dto.notes || '',
    });
  }

  async listMyApplications(centralUserId: string): Promise<RiderApplication[]> {
    const user = await this.userModel.findOne({ centralUserId });
    if (!user) return [];
    return this.appModel
      .find({ riderId: user._id })
      .populate('homeId')
      .sort({ createdAt: -1 })
      .exec();
  }

  async cancelApplication(centralUserId: string, id: string): Promise<{ cancelled: boolean }> {
    const user = await this.userModel.findOne({ centralUserId });
    if (!user) throw new BadRequestException('User not found');
    await this.appModel.updateOne(
      { _id: id, riderId: user._id },
      { status: 'CANCELLED' },
    );
    return { cancelled: true };
  }
}
