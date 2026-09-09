import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  RiderApplication,
  RiderApplicationDocument,
  CommuteDirection,
} from '../applications/schemas/rider-application.schema';
import { UserHome, UserHomeDocument } from '../homes/schemas/user-home.schema';
import { LocalUser, LocalUserDocument } from '../auth/schemas/local-user.schema';

@Injectable()
export class MatchingService {
  constructor(
    @InjectModel(RiderApplication.name)
    private readonly appModel: Model<RiderApplicationDocument>,
    @InjectModel(UserHome.name)
    private readonly homeModel: Model<UserHomeDocument>,
    @InjectModel(LocalUser.name)
    private readonly userModel: Model<LocalUserDocument>,
  ) {}

  /**
   * Finds active rider applications matching a driver's commute plan.
   * 
   * Searches by:
   * 1. Commute Direction (HOME_TO_SCHOOL or SCHOOL_TO_HOME)
   * 2. Proximity: Uses MongoDB 2dsphere nearSphere query to find rider home locations
   *    within a reasonable search radius (e.g. 5,000 meters) of the driver's home.
   */
  async findMatchingRiders(
    centralUserId: string,
    query: {
      direction: CommuteDirection;
      driverHomeId: string;
      maxDistanceMeters?: number;
    },
  ): Promise<any[]> {
    const driver = await this.userModel.findOne({ centralUserId });
    if (!driver) throw new BadRequestException('Driver not found');

    const driverHome = await this.homeModel.findOne({
      _id: query.driverHomeId,
      userId: driver._id,
    });
    if (!driverHome) throw new BadRequestException('Driver home location not found');

    const maxDistance = query.maxDistanceMeters || 5000; // 5 km radius

    // MongoDB 2dsphere proximity query
    const applications = await this.appModel
      .find({
        status: 'OPEN',
        direction: query.direction,
        riderId: { $ne: driver._id }, // Driver cannot ride with themselves
        pickupLocation: {
          $nearSphere: {
            $geometry: {
              type: 'Point',
              coordinates: driverHome.location.coordinates,
            },
            $maxDistance: maxDistance,
          },
        },
      })
      .populate('riderId', 'fullName eduEmail ratingAverage ratingCount')
      .populate('homeId', 'label address walkingRadiusMeters')
      .limit(30)
      .exec();

    return applications;
  }
}
