import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VerificationService } from './verification.service';
import { EduVerification } from './schemas/edu-verification.schema';
import { LocalUser } from '../auth/schemas/local-user.schema';

describe('VerificationService', () => {
  let service: VerificationService;

  const mockUserDoc = {
    _id: 'local_user_1',
    centralUserId: 'usr_student_01',
    fullName: 'Jane Doe',
    isEduVerified: false,
    save: jest.fn().mockResolvedValue(true),
  };

  const mockVerificationDoc = {
    _id: 'verif_01',
    userId: 'local_user_1',
    eduEmail: 'jane@ubc.ca',
    code: '123456',
    attempts: 0,
    save: jest.fn().mockResolvedValue(true),
  };

  const mockVerificationModel = {
    deleteMany: jest.fn().mockResolvedValue({}),
    deleteOne: jest.fn().mockResolvedValue({}),
    create: jest.fn().mockResolvedValue(mockVerificationDoc),
    findOne: jest.fn(),
  };

  const mockUserModel = {
    findOne: jest.fn(),
    create: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VerificationService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              if (key === 'ALLOWED_EMAIL_DOMAINS') return 'ubc.ca,student.ubc.ca';
              return defaultValue;
            }),
          },
        },
        {
          provide: getModelToken(EduVerification.name),
          useValue: mockVerificationModel,
        },
        {
          provide: getModelToken(LocalUser.name),
          useValue: mockUserModel,
        },
      ],
    }).compile();

    service = module.get<VerificationService>(VerificationService);
  });

  describe('sendCode', () => {
    it('should reject email domains not permitted by school server', async () => {
      await expect(
        service.sendCode('usr_student_01', 'attacker@gmail.com'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should generate and dispatch 6-digit OTP to valid .edu email', async () => {
      mockUserModel.findOne.mockResolvedValue(mockUserDoc);

      const result = await service.sendCode('usr_student_01', 'student@ubc.ca');
      expect(result.success).toBe(true);
      expect(mockVerificationModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: mockUserDoc._id,
          eduEmail: 'student@ubc.ca',
          attempts: 0,
        }),
      );
    });
  });

  describe('verifyCode', () => {
    it('should verify correct code and mark isEduVerified: true', async () => {
      mockUserModel.findOne.mockResolvedValue(mockUserDoc);
      mockVerificationModel.findOne.mockResolvedValue({
        ...mockVerificationDoc,
        code: '654321',
        attempts: 0,
      });

      const result = await service.verifyCode('usr_student_01', '654321');
      expect(result.verified).toBe(true);
      expect(mockUserDoc.isEduVerified).toBe(true);
      expect(mockUserDoc.save).toHaveBeenCalled();
    });

    it('should increment attempts and reject incorrect code', async () => {
      const verifRecord = {
        ...mockVerificationDoc,
        code: '654321',
        attempts: 0,
        save: jest.fn().mockResolvedValue(true),
      };
      mockUserModel.findOne.mockResolvedValue(mockUserDoc);
      mockVerificationModel.findOne.mockResolvedValue(verifRecord);

      await expect(
        service.verifyCode('usr_student_01', '999999'),
      ).rejects.toThrow(BadRequestException);

      expect(verifRecord.attempts).toBe(1);
      expect(verifRecord.save).toHaveBeenCalled();
    });

    it('should lock out and delete record after 5 failed attempts', async () => {
      const verifRecord = {
        ...mockVerificationDoc,
        code: '654321',
        attempts: 5,
      };
      mockUserModel.findOne.mockResolvedValue(mockUserDoc);
      mockVerificationModel.findOne.mockResolvedValue(verifRecord);

      await expect(
        service.verifyCode('usr_student_01', '654321'),
      ).rejects.toThrow(BadRequestException);

      expect(mockVerificationModel.deleteOne).toHaveBeenCalled();
    });
  });
});
