import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nacl from 'tweetnacl';
import * as naclUtil from 'tweetnacl-util';

import * as fs from 'fs';
import * as path from 'path';

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
        this.logger.log(`🔐 School Ed25519 Keypair loaded from environment. Public Key: ${pubKey}`);
        return;
      } catch (err) {
        this.logger.error(`Failed to decode base64 keys: ${err.message}`);
      }
    }

    // Check filesystem key file
    const keyFilePath = this.configService.get<string>(
      'SCHOOL_KEY_FILE',
      path.resolve(process.cwd(), '.keys/school_keypair.json'),
    );

    try {
      if (fs.existsSync(keyFilePath)) {
        const fileContent = fs.readFileSync(keyFilePath, 'utf8');
        const parsed = JSON.parse(fileContent);
        if (parsed.publicKey && parsed.privateKey) {
          this.keyPair = {
            publicKey: naclUtil.decodeBase64(parsed.publicKey),
            secretKey: naclUtil.decodeBase64(parsed.privateKey),
          };
          this.logger.log(`🔐 School Ed25519 Keypair loaded from file: ${keyFilePath}`);
          return;
        }
      }
    } catch (fileErr) {
      this.logger.warn(`Could not read key file at ${keyFilePath}: ${fileErr.message}`);
    }

    // Generate persistent keypair
    this.keyPair = nacl.sign.keyPair();
    const generatedPub = naclUtil.encodeBase64(this.keyPair.publicKey);
    const generatedPriv = naclUtil.encodeBase64(this.keyPair.secretKey);

    try {
      const dir = path.dirname(keyFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(
        keyFilePath,
        JSON.stringify({ publicKey: generatedPub, privateKey: generatedPriv }, null, 2),
        { encoding: 'utf8', mode: 0o600 },
      );
      this.logger.log(`💾 Generated and saved new School Ed25519 keypair to ${keyFilePath}`);
    } catch (writeErr) {
      this.logger.warn(
        `⚠️  Could not write keypair to ${keyFilePath} (${writeErr.message}). Using ephemeral in-memory keys.`,
      );
    }

    this.logger.log(`   SCHOOL PUBLIC KEY:  ${generatedPub}`);
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
      maxUsersPerEduEmail: parseInt(
        this.configService.get<string>('MAX_USERS_PER_EDU_EMAIL', '1'),
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
