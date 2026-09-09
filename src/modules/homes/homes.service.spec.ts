import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HomesService } from './homes.service';
import { UserHome } from './schemas/user-home.schema';
import { LocalUser } from '../auth/schemas/local-user.schema';

describe('HomesService', () => {
  let service: HomesService;

  const mockUserDoc = {
    _id: 'user_local_123',
    centralUserId: 'usr_student_01',
    fullName: 'Test Student',
  };

  const mockHomeModel = {
    countDocuments: jest.fn(),
    create: jest.fn(),
    find: jest.fn(),
    deleteOne: jest.fn(),
  };

  const mockUserModel = {
    findOne: jest.fn(),
    create: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HomesService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              if (key === 'MAX_HOMES_PER_USER') return '3';
              return defaultValue;
            }),
          },
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

    service = module.get<HomesService>(HomesService);
  });

  it('should create a saved home with walking radius', async () => {
    mockUserModel.findOne.mockResolvedValue(mockUserDoc);
    mockHomeModel.countDocuments.mockResolvedValue(0);
    mockHomeModel.create.mockImplementation((data) => Promise.resolve({ _id: 'home_01', ...data }));

    const result = await service.createHome('usr_student_01', {
      label: 'Campus Dorm',
      address: 'Marine Drive Residence, Vancouver, BC',
      latitude: 49.261,
      longitude: -123.255,
      walkingRadiusMeters: 100,
    });

    expect(result).toBeDefined();
    expect(result.walkingRadiusMeters).toBe(100);
    expect(result.location.coordinates).toEqual([-123.255, 49.261]);
  });

  it('should enforce MAX_HOMES_PER_USER limit', async () => {
    mockUserModel.findOne.mockResolvedValue(mockUserDoc);
    mockHomeModel.countDocuments.mockResolvedValue(3); // Already at limit of 3

    await expect(
      service.createHome('usr_student_01', {
        label: 'Another Home',
        address: '4th Avenue, Vancouver, BC',
        latitude: 49.265,
        longitude: -123.24,
        walkingRadiusMeters: 50,
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
