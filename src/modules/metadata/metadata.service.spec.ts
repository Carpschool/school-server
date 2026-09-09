import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MetadataService } from './metadata.service';
import * as nacl from 'tweetnacl';
import * as naclUtil from 'tweetnacl-util';

describe('MetadataService', () => {
  let service: MetadataService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetadataService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              if (key === 'SCHOOL_KEY_FILE') return '/tmp/test_school_meta_key.json';
              if (key === 'SCHOOL_CODE') return 'ubc';
              if (key === 'OFFICIAL_NAME') return 'University of British Columbia';
              return defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<MetadataService>(MetadataService);
    service.onModuleInit();
  });

  it('should generate valid school metadata signed with Ed25519 private key', () => {
    const { payloadString, payloadObj, signatureBase64 } = service.getSignedMetadata();

    expect(payloadObj.schoolCode).toBe('ubc');
    expect(payloadObj.officialName).toBe('University of British Columbia');
    expect(payloadObj.ed25519PublicKey).toBe(service.getPublicKeyBase64());
    expect(signatureBase64).toBeDefined();

    // Verify cryptographic signature against payloadString
    const messageBytes = naclUtil.decodeUTF8(payloadString);
    const signatureBytes = naclUtil.decodeBase64(signatureBase64);
    const publicKeyBytes = naclUtil.decodeBase64(payloadObj.ed25519PublicKey);

    const isValid = nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
    expect(isValid).toBe(true);
  });
});
