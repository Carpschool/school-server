import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { MatchingService } from './matching.service';
import { RiderApplication, CommuteDirection } from '../applications/schemas/rider-application.schema';
import { UserHome } from '../homes/schemas/user-home.schema';
import { LocalUser } from '../auth/schemas/local-user.schema';

describe('MatchingService', () => {
  let service: MatchingService;

  const mockDriverDoc = {
    _id: 'driver_01',
    centralUserId: 'usr_driver_bob',
    fullName: 'Bob Driver',
    role: 'driver',
    isEduVerified: true,
    personalEmail: 'bob@gmail.com',
  };

  const mockDriverHome = {
    _id: 'home_01',
    userId: 'driver_01',
    location: {
      type: 'Point',
      coordinates: [-123.246, 49.2606],
    },
  };

  const mockAppModel = {
    find: jest.fn().mockReturnThis(),
    populate: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([]),
  };

  const mockHomeModel = {
    findOne: jest.fn(),
  };

  const mockUserModel = {
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MatchingService,
        {
          provide: getModelToken(RiderApplication.name),
          useValue: mockAppModel,
        },
        {
          provide: getModelToken(UserHome.name),
          useValue: mockHomeModel,
        },
        {
          provide: getModelToken(LocalUser.name),
          useValue: mockUserModel,
        },
      ],
    }).compile();

    service = module.get<MatchingService>(MatchingService);
  });

  describe('findMatchingRiders', () => {
    it('should reject if user is not a registered driver', async () => {
      mockUserModel.findOne.mockResolvedValue({
        ...mockDriverDoc,
        role: 'rider',
        userRoles: ['rider'],
      });

      await expect(
        service.findMatchingRiders('usr_driver_bob', {
          direction: CommuteDirection.HOME_TO_SCHOOL,
          driverHomeId: 'home_01',
        }),
      ).rejects.toThrow('Only registered Drivers can search the commute corridor.');
    });

    it('should reject if driver is not school .edu verified', async () => {
      mockUserModel.findOne.mockResolvedValue({
        ...mockDriverDoc,
        isEduVerified: false,
      });

      await expect(
        service.findMatchingRiders('usr_driver_bob', {
          direction: CommuteDirection.HOME_TO_SCHOOL,
          driverHomeId: 'home_01',
        }),
      ).rejects.toThrow('Driver must verify their institutional school email first.');
    });

    it('should reject if driver does not have a personal user email configured', async () => {
      mockUserModel.findOne.mockResolvedValue({
        ...mockDriverDoc,
        isEduVerified: true,
        personalEmail: null,
      });

      await expect(
        service.findMatchingRiders('usr_driver_bob', {
          direction: CommuteDirection.HOME_TO_SCHOOL,
          driverHomeId: 'home_01',
        }),
      ).rejects.toThrow('Driver must configure a personal user email in their profile.');
    });

    it('should query matching riders when driver has both school email and personal email', async () => {
      mockUserModel.findOne.mockResolvedValue(mockDriverDoc);
      mockHomeModel.findOne.mockResolvedValue(mockDriverHome);

      const result = await service.findMatchingRiders('usr_driver_bob', {
        direction: CommuteDirection.HOME_TO_SCHOOL,
        driverHomeId: 'home_01',
      });

      expect(Array.isArray(result)).toBe(true);
      expect(mockAppModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          direction: CommuteDirection.HOME_TO_SCHOOL,
          status: 'OPEN',
        }),
      );
    });
  });
});
