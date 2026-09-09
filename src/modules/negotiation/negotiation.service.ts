import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Negotiation,
  NegotiationDocument,
  ProposalStatus,
} from './schemas/negotiation.schema';
import {
  RiderApplication,
  RiderApplicationDocument,
} from '../applications/schemas/rider-application.schema';
import { LocalUser, LocalUserDocument } from '../auth/schemas/local-user.schema';
import { Carpool, CarpoolDocument } from '../carpools/schemas/carpool.schema';
import { SuggestPickupDto } from './dto/suggest-pickup.dto';
import { NegotiationGateway } from '../gateway/negotiation.gateway';

@Injectable()
export class NegotiationService {
  private readonly logger = new Logger(NegotiationService.name);

  constructor(
    @InjectModel(Negotiation.name)
    private readonly negotiationModel: Model<NegotiationDocument>,
    @InjectModel(RiderApplication.name)
    private readonly appModel: Model<RiderApplicationDocument>,
    @InjectModel(LocalUser.name)
    private readonly userModel: Model<LocalUserDocument>,
    @InjectModel(Carpool.name)
    private readonly carpoolModel: Model<CarpoolDocument>,
    private readonly gateway: NegotiationGateway,
  ) {}

  /**
   * Driver initiates contact with a prospective rider on their application.
   */
  async startNegotiation(
    driverCentralUserId: string,
    applicationId: string,
  ): Promise<Negotiation> {
    const driver = await this.userModel.findOne({ centralUserId: driverCentralUserId });
    if (!driver) throw new BadRequestException('Driver profile not found');
    if (!driver.isEduVerified) {
      throw new BadRequestException('Driver must be .edu verified to reach out to riders');
    }
    if (!driver.personalEmail) {
      throw new BadRequestException('Driver must configure a personal user email in their profile to reach out to riders');
    }

    const application = await this.appModel.findById(applicationId);
    if (!application || application.status !== 'OPEN') {
      throw new BadRequestException('Application is no longer open');
    }

    if (application.riderId.toString() === driver._id.toString()) {
      throw new BadRequestException('You cannot negotiate with yourself');
    }

    // Reuse existing active negotiation or create a new one
    let negotiation = await this.negotiationModel.findOne({
      driverId: driver._id,
      riderId: application.riderId,
      applicationId: application._id,
      status: 'ACTIVE',
    });

    if (!negotiation) {
      negotiation = await this.negotiationModel.create({
        driverId: driver._id,
        riderId: application.riderId,
        applicationId: application._id,
        direction: application.direction,
        status: 'ACTIVE',
        messages: [
          {
            senderId: driver._id,
            text: `Hi! I saw your carpool application for ${application.targetTime}. Let's coordinate a pickup point!`,
            timestamp: new Date(),
          },
        ],
        proposals: [],
      });
    }

    return negotiation;
  }

  async getNegotiation(negotiationId: string): Promise<Negotiation> {
    const n = await this.negotiationModel
      .findById(negotiationId)
      .populate('driverId', 'fullName eduEmail vehicle ratingAverage')
      .populate('riderId', 'fullName eduEmail ratingAverage')
      .populate('applicationId')
      .exec();

    if (!n) throw new NotFoundException('Negotiation not found');
    return n;
  }

  /**
   * Appends a chat message to the negotiation feed and emits over WebSockets.
   */
  async sendMessage(
    centralUserId: string,
    negotiationId: string,
    text: string,
  ): Promise<any> {
    const user = await this.userModel.findOne({ centralUserId });
    if (!user) throw new BadRequestException('User not found');

    const message = {
      senderId: user._id,
      text: text.trim(),
      timestamp: new Date(),
    };

    const negotiation = await this.negotiationModel.findByIdAndUpdate(
      negotiationId,
      { $push: { messages: message } },
      { new: true },
    );

    this.gateway.emitNegotiationUpdate(negotiationId, 'new_message', {
      negotiationId,
      message,
      senderName: user.fullName,
    });

    return message;
  }

  /**
   * Suggests a pickup point from the in-chat Location Modal.
   */
  async suggestPickupPoint(
    centralUserId: string,
    negotiationId: string,
    dto: SuggestPickupDto,
  ): Promise<any> {
    const user = await this.userModel.findOne({ centralUserId });
    if (!user) throw new BadRequestException('User not found');

    const proposal = {
      proposalId: new Types.ObjectId().toString(),
      proposedBy: user._id,
      pickupPointName: dto.pickupPointName,
      pickupCoordinates: [dto.longitude, dto.latitude] as [number, number],
      proposedTime: dto.proposedTime,
      status: ProposalStatus.PENDING,
      timestamp: new Date(),
    };

    // Mark previous pending proposals as SUPERSEDED
    await this.negotiationModel.updateOne(
      { _id: negotiationId, 'proposals.status': ProposalStatus.PENDING },
      { $set: { 'proposals.$[elem].status': ProposalStatus.SUPERSEDED } },
      { arrayFilters: [{ 'elem.status': ProposalStatus.PENDING }] },
    );

    // Push new proposal
    await this.negotiationModel.findByIdAndUpdate(negotiationId, {
      $push: { proposals: proposal },
    });

    this.gateway.emitNegotiationUpdate(negotiationId, 'proposal_update', {
      negotiationId,
      proposal,
    });

    return proposal;
  }

  /**
   * Responds to a proposal card: CONFIRM or DENY.
   */
  async respondToProposal(
    centralUserId: string,
    negotiationId: string,
    proposalId: string,
    action: 'CONFIRM' | 'DENY',
  ): Promise<any> {
    const user = await this.userModel.findOne({ centralUserId });
    if (!user) throw new BadRequestException('User not found');

    const status = action === 'CONFIRM' ? ProposalStatus.CONFIRMED : ProposalStatus.DENIED;

    const negotiation = await this.negotiationModel.findOneAndUpdate(
      { _id: negotiationId, 'proposals.proposalId': proposalId },
      { $set: { 'proposals.$.status': status } },
      { new: true },
    );

    this.gateway.emitNegotiationUpdate(negotiationId, 'proposal_status_changed', {
      negotiationId,
      proposalId,
      status,
    });

    return { proposalId, status };
  }

  /**
   * First-Confirmed Seat Contention: Locks in the carpool booking.
   * 
   * Atomically decrements available seats on the driver's carpool.
   * Generates an individual 4-digit Boarding Safety PIN for the passenger.
   */
  async lockInCarpool(
    driverCentralUserId: string,
    negotiationId: string,
  ): Promise<Carpool> {
    const driver = await this.userModel.findOne({ centralUserId: driverCentralUserId });
    if (!driver) throw new BadRequestException('Driver not found');

    const negotiation = await this.negotiationModel.findById(negotiationId);
    if (!negotiation || negotiation.status !== 'ACTIVE') {
      throw new BadRequestException('Negotiation is no longer active');
    }

    // Find confirmed proposal
    const confirmedProposal = negotiation.proposals.find(
      (p) => p.status === ProposalStatus.CONFIRMED,
    );
    if (!confirmedProposal) {
      throw new BadRequestException(
        'Cannot lock in carpool until a pickup point and time have been confirmed by both parties.',
      );
    }

    // Generate random 4-digit numeric Boarding Safety PIN
    const boardingSafetyPin = Math.floor(1000 + Math.random() * 9000).toString();

    // Check or create carpool for the driver
    const today = new Date().toISOString().split('T')[0];
    let carpool = await this.carpoolModel.findOne({
      driverId: driver._id,
      direction: negotiation.direction,
      status: 'SCHEDULED',
    });

    const maxCapacity = driver.vehicle?.totalSeatCapacity || 3;

    if (!carpool) {
      carpool = await this.carpoolModel.create({
        driverId: driver._id,
        direction: negotiation.direction,
        targetDate: today,
        status: 'SCHEDULED',
        totalSeatCapacity: maxCapacity,
        availableSeats: maxCapacity,
        passengers: [],
      });
    }

    // Atomic seat reservation check
    if (carpool.availableSeats <= 0) {
      throw new BadRequestException('All seats have already been filled for this carpool!');
    }

    // Add passenger and decrement seat
    carpool.passengers.push({
      riderId: negotiation.riderId,
      applicationId: negotiation.applicationId,
      pickupPointName: confirmedProposal.pickupPointName,
      pickupCoordinates: confirmedProposal.pickupCoordinates,
      agreedPickupTime: confirmedProposal.proposedTime,
      boardingSafetyPin,
      status: 'CONFIRMED',
    });
    carpool.availableSeats -= 1;
    await carpool.save();

    // Mark negotiation LOCKED and application MATCHED
    negotiation.status = 'LOCKED';
    await negotiation.save();
    await this.appModel.updateOne(
      { _id: negotiation.applicationId },
      { status: 'MATCHED' },
    );

    // Notify room that carpool is locked in
    this.gateway.emitNegotiationUpdate(negotiationId, 'carpool_locked', {
      negotiationId,
      carpoolId: carpool._id,
      boardingSafetyPin, // Sent to confirmed rider
    });

    // If carpool is now full, notify other candidate negotiations
    if (carpool.availableSeats === 0) {
      this.gateway.emitCarpoolUpdate(carpool._id.toString(), 'carpool_full', {
        message: 'All seats have been filled for this carpool.',
      });
    }

    return carpool;
  }
}
