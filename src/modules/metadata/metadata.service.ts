import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nacl from 'tweetnacl';
import * as naclUtil from 'tweetnacl-util';

/**
 * MetadataService
 * 
 * Manages the School Server's Ed25519 keypair and creates the cryptographically
 * signed metadata package returned by GET /api/v1/meta for automated Central Server onboarding.
 */
@Injectable()
export class MetadataService implements OnModuleInit {
  private readonly logger = new Logger(MetadataService.name);
  private keyPair: nacl.SignKeyPair;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    this.initializeKeys();
  }

  private initializeKeys(): void {
    const privKey = this.configService.get<string>('SCHOOL_ED25519_PRIVATE_KEY');
    const pubKey = this.configService.get<string>('SCHOOL_ED25519_PUBLIC_KEY');

    if (privKey && pubKey) {
      try {
        this.keyPair = {
          publicKey: naclUtil.decodeBase64(pubKey),
          secretKey: naclUtil.decodeBase64(privKey),
        };
        this.logger.log(`🔐 School Ed25519 Keypair loaded. Public Key: ${pubKey}`);
        return;
      } catch (err) {
        this.logger.error(`Failed to decode base64 keys: ${err.message}`);
      }
    }

    // Generate ephemeral keypair for development
    this.keyPair = nacl.sign.keyPair();
    const generatedPub = naclUtil.encodeBase64(this.keyPair.publicKey);
    const generatedPriv = naclUtil.encodeBase64(this.keyPair.secretKey);
    this.logger.warn(
      `⚠️  No school keys provided in environment. Generated ephemeral keypair for development:\n` +
      `   SCHOOL PUB KEY:  ${generatedPub}\n` +
      `   SCHOOL PRIV KEY: ${generatedPriv}`
    );
  }

  getPublicKeyBase64(): string {
    return naclUtil.encodeBase64(this.keyPair.publicKey);
  }

  /**
   * Generates the institution metadata package and signs it with the School Server's
   * private Ed25519 key.
   */
  getSignedMetadata(): { payloadString: string; payloadObj: any; signatureBase64: string } {
    const metadata = {
      schoolCode: this.configService.get<string>('SCHOOL_CODE', 'ubc'),
      officialName: this.configService.get<string>(
        'OFFICIAL_NAME',
        'University of British Columbia',
      ),
      allowedEmailDomains: this.configService
        .get<string>('ALLOWED_EMAIL_DOMAINS', 'ubc.ca,student.ubc.ca')
        .split(',')
        .map((d) => d.trim()),
      campusLocation: {
        name: this.configService.get<string>('CAMPUS_NAME', 'Main Campus'),
        address: this.configService.get<string>('CAMPUS_ADDRESS', 'University Boulevard'),
        latitude: parseFloat(this.configService.get<string>('CAMPUS_LATITUDE', '49.2606')),
        longitude: parseFloat(this.configService.get<string>('CAMPUS_LONGITUDE', '-123.2460')),
      },
      maxCarpoolStudents: parseInt(
        this.configService.get<string>('MAX_CARPOOL_STUDENTS', '4'),
        10,
      ),
      maxHomesPerUser: parseInt(
        this.configService.get<string>('MAX_HOMES_PER_USER', '3'),
        10,
      ),
      ed25519PublicKey: this.getPublicKeyBase64(),
      timestamp: new Date().toISOString(),
    };

    const payloadString = JSON.stringify(metadata);
    const messageBytes = naclUtil.decodeUTF8(payloadString);
    const signatureBytes = nacl.sign.detached(messageBytes, this.keyPair.secretKey);
    const signatureBase64 = naclUtil.encodeBase64(signatureBytes);

    return { payloadString, payloadObj: metadata, signatureBase64 };
  }
}
