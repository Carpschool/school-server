import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Carpool, CarpoolDocument } from './schemas/carpool.schema';
import { LocalUser, LocalUserDocument } from '../auth/schemas/local-user.schema';
import { SubmitBoardingPinDto } from './dto/boarding-pin.dto';
import { EndRideDto } from './dto/end-ride.dto';
import { NegotiationGateway } from '../gateway/negotiation.gateway';

@Injectable()
export class CarpoolsService {
  private readonly logger = new Logger(CarpoolsService.name);

  constructor(
    @InjectModel(Carpool.name)
    private readonly carpoolModel: Model<CarpoolDocument>,
    @InjectModel(LocalUser.name)
    private readonly userModel: Model<LocalUserDocument>,
    private readonly gateway: NegotiationGateway,
  ) {}

  async getCarpool(id: string): Promise<Carpool> {
    const carpool = await this.carpoolModel
      .findById(id)
      .populate('driverId', 'fullName vehicle ratingAverage')
      .populate('passengers.riderId', 'fullName eduEmail')
      .exec();

    if (!carpool) throw new NotFoundException('Carpool not found');
    return carpool;
  }

  /**
   * Boarding Verification
   * 
   * Driver inputs the rider's 4-digit PIN.
   * Client captures a SINGLE discrete GPS read at that instant.
   */
  async submitBoardingPin(
    driverCentralUserId: string,
    carpoolId: string,
    dto: SubmitBoardingPinDto,
  ): Promise<{ boarded: boolean; passengerName: string }> {
    const driver = await this.userModel.findOne({ centralUserId: driverCentralUserId });
    if (!driver) throw new BadRequestException('Driver not found');

    const carpool = await this.carpoolModel.findOne({
      _id: carpoolId,
      driverId: driver._id,
    });
    if (!carpool) throw new NotFoundException('Carpool not found or not owned by driver');

    const passenger = carpool.passengers.find(
      (p) => p.riderId.toString() === dto.riderId,
    );
    if (!passenger) throw new NotFoundException('Passenger not found on this carpool roster');

    if (passenger.boardingSafetyPin !== dto.pin.trim()) {
      throw new BadRequestException('Incorrect 4-digit Boarding Safety PIN!');
    }

    // Success! Log single GPS read and mark boarded
    passenger.status = 'BOARDED';
    passenger.boardingTimestamp = new Date();
    passenger.boardingCoordinates = [dto.longitude, dto.latitude];

    // Transition carpool status to ACTIVE if first passenger boarded
    if (carpool.status === 'SCHEDULED') {
      carpool.status = 'ACTIVE';
    }

    await carpool.save();

    this.logger.log(
      `✅ Passenger ${passenger.riderId} boarded! GPS: [${dto.latitude}, ${dto.longitude}]`,
    );

    this.gateway.emitCarpoolUpdate(carpoolId, 'passenger_boarded', {
      carpoolId,
      riderId: dto.riderId,
      boardingTimestamp: passenger.boardingTimestamp,
    });

    return { boarded: true, passengerName: passenger.pickupPointName };
  }

  /**
   * End Ride Completion
   * 
   * Driver taps "End Ride" upon reaching destination.
   * Client captures a SINGLE discrete GPS read.
   */
  async endRide(
    driverCentralUserId: string,
    carpoolId: string,
    dto: EndRideDto,
  ): Promise<Carpool> {
    const driver = await this.userModel.findOne({ centralUserId: driverCentralUserId });
    if (!driver) throw new BadRequestException('Driver not found');

    const carpool = await this.carpoolModel.findOne({
      _id: carpoolId,
      driverId: driver._id,
    });
    if (!carpool) throw new NotFoundException('Carpool not found');

    carpool.status = 'COMPLETED';
    carpool.endRideTimestamp = new Date();
    carpool.endRideCoordinates = [dto.longitude, dto.latitude];
    await carpool.save();

    this.logger.log(
      `🏁 Carpool ${carpoolId} completed! Final GPS: [${dto.latitude}, ${dto.longitude}]`,
    );

    this.gateway.emitCarpoolUpdate(carpoolId, 'ride_completed', {
      carpoolId,
      endRideTimestamp: carpool.endRideTimestamp,
    });

    return carpool;
  }
}
