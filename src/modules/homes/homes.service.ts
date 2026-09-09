import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserHome, UserHomeDocument } from './schemas/user-home.schema';
import { LocalUser, LocalUserDocument } from '../auth/schemas/local-user.schema';
import { CreateHomeDto } from './dto/create-home.dto';

@Injectable()
export class HomesService {
  constructor(
    @InjectModel(UserHome.name)
    private readonly homeModel: Model<UserHomeDocument>,
    @InjectModel(LocalUser.name)
    private readonly userModel: Model<LocalUserDocument>,
    private readonly configService: ConfigService,
  ) {}

  async createHome(centralUserId: string, dto: CreateHomeDto): Promise<UserHome> {
    const user = await this.userModel.findOne({ centralUserId });
    if (!user) throw new BadRequestException('User not found');

    const maxHomes = parseInt(
      this.configService.get<string>('MAX_HOMES_PER_USER', '3'),
      10,
    );
    const existingCount = await this.homeModel.countDocuments({ userId: user._id });

    if (existingCount >= maxHomes) {
      throw new BadRequestException(
        `You have reached the maximum allowed saved homes (${maxHomes}) for this school.`,
      );
    }

    return this.homeModel.create({
      userId: user._id,
      label: dto.label,
      address: dto.address,
      location: {
        type: 'Point',
        coordinates: [dto.longitude, dto.latitude],
      },
      walkingRadiusMeters: dto.walkingRadiusMeters,
      isDefault: existingCount === 0,
    });
  }

  async listHomes(centralUserId: string): Promise<UserHome[]> {
    const user = await this.userModel.findOne({ centralUserId });
    if (!user) return [];
    return this.homeModel.find({ userId: user._id }).exec();
  }

  async deleteHome(centralUserId: string, homeId: string): Promise<{ deleted: boolean }> {
    const user = await this.userModel.findOne({ centralUserId });
    if (!user) throw new BadRequestException('User not found');
    await this.homeModel.deleteOne({ _id: homeId, userId: user._id });
    return { deleted: true };
  }
}
