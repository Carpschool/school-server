import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CarpoolsService } from './carpools.service';
import { Carpool } from './schemas/carpool.schema';
import { LocalUser } from '../auth/schemas/local-user.schema';
import { NegotiationGateway } from '../gateway/negotiation.gateway';

describe('CarpoolsService', () => {
  let service: CarpoolsService;

  const mockDriver = {
    _id: 'driver_01',
    centralUserId: 'usr_driver',
  };

  const mockPassenger = {
    riderId: 'rider_01',
    boardingSafetyPin: '4829',
    pickupPointName: 'Library Loop',
    status: 'CONFIRMED',
    boardingTimestamp: null,
    boardingCoordinates: null,
  };

  const mockCarpoolDoc = {
    _id: 'carpool_01',
    driverId: 'driver_01',
    status: 'SCHEDULED',
    passengers: [mockPassenger],
    endRideCoordinates: null as any,
    endRideTimestamp: null as any,
    save: jest.fn().mockResolvedValue(true),
  };

  const mockCarpoolModel = {
    findById: jest.fn(),
    findOne: jest.fn(),
  };

  const mockUserModel = {
    findOne: jest.fn(),
  };

  const mockGateway = {
    emitCarpoolUpdate: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CarpoolsService,
        {
          provide: getModelToken(Carpool.name),
          useValue: mockCarpoolModel,
        },
        {
          provide: getModelToken(LocalUser.name),
          useValue: mockUserModel,
        },
        {
          provide: NegotiationGateway,
          useValue: mockGateway,
        },
      ],
    }).compile();

    service = module.get<CarpoolsService>(CarpoolsService);
  });

  describe('submitBoardingPin', () => {
    it('should verify correct 4-digit PIN and record single discrete GPS snapshot', async () => {
      mockUserModel.findOne.mockResolvedValue(mockDriver);
      mockCarpoolModel.findOne.mockResolvedValue(mockCarpoolDoc);

      const result = await service.submitBoardingPin('usr_driver', 'carpool_01', {
        riderId: 'rider_01',
        pin: '4829',
        latitude: 49.2612,
        longitude: -123.2498,
      });

      expect(result.boarded).toBe(true);
      expect(mockPassenger.status).toBe('BOARDED');
      expect(mockPassenger.boardingCoordinates).toEqual([-123.2498, 49.2612]);
      expect(mockCarpoolDoc.status).toBe('ACTIVE');
      expect(mockCarpoolDoc.save).toHaveBeenCalled();
      expect(mockGateway.emitCarpoolUpdate).toHaveBeenCalledWith(
        'carpool_01',
        'passenger_boarded',
        expect.anything(),
      );
    });

    it('should reject incorrect 4-digit PIN', async () => {
      mockUserModel.findOne.mockResolvedValue(mockDriver);
      mockCarpoolModel.findOne.mockResolvedValue(mockCarpoolDoc);

      await expect(
        service.submitBoardingPin('usr_driver', 'carpool_01', {
          riderId: 'rider_01',
          pin: '0000', // Wrong PIN
          latitude: 49.2612,
          longitude: -123.2498,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('endRide', () => {
    it('should complete ride and capture single discrete GPS snapshot with zero live streaming', async () => {
      mockUserModel.findOne.mockResolvedValue(mockDriver);
      mockCarpoolModel.findOne.mockResolvedValue(mockCarpoolDoc);

      const result = await service.endRide('usr_driver', 'carpool_01', {
        latitude: 49.2606,
        longitude: -123.246,
      });

      expect(result.status).toBe('COMPLETED');
      expect(mockCarpoolDoc.endRideCoordinates).toEqual([-123.246, 49.2606]);
      expect(mockCarpoolDoc.save).toHaveBeenCalled();
      expect(mockGateway.emitCarpoolUpdate).toHaveBeenCalledWith(
        'carpool_01',
        'ride_completed',
        expect.anything(),
      );
    });
  });
});
