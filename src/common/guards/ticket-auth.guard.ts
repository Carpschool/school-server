import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nacl from 'tweetnacl';
import * as naclUtil from 'tweetnacl-util';

/**
 * TicketAuthGuard
 * 
 * Cryptographically validates the Central Server's Ed25519 signature on incoming
 * Federation Tickets passed in 'Authorization: Bearer <ticket>'.
 * 
 * CRITICAL ARCHITECTURE FEATURE:
 * Verification happens 100% locally and offline using the Central Server's public key.
 * No network calls back to the Central Server are made, resulting in zero latency.
 */
@Injectable()
export class TicketAuthGuard implements CanActivate {
  private readonly logger = new Logger(TicketAuthGuard.name);

  constructor(private readonly configService: ConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Missing Authorization header. Expected Bearer <federation_ticket>',
      );
    }

    const rawToken = authHeader.split(' ')[1];

    try {
      // In development mode, allow mock token bypass for direct unit/integration tests
      if (
        this.configService.get<string>('NODE_ENV') !== 'production' &&
        rawToken.startsWith('mock_')
      ) {
        request['user'] = {
          centralUserId: rawToken.replace('mock_', 'usr_'),
          clerkUserId: rawToken.replace('mock_', 'clerk_'),
          fullName: 'Test Student',
          primaryEmail: 'test@carpschool.ca',
          isTrusted: true,
        };
        return true;
      }

      // Decode the Base64 token package issued by Central Server
      const tokenJsonString = Buffer.from(rawToken, 'base64').toString('utf-8');
      const tokenPackage = JSON.parse(tokenJsonString);

      const { data, signature, centralPublicKey } = tokenPackage;

      if (!data || !signature) {
        throw new UnauthorizedException('Malformed federation ticket package');
      }

      // Check ticket expiration
      const expiresAt = new Date(data.expiresAt);
      if (expiresAt.getTime() < Date.now()) {
        throw new UnauthorizedException('Federation ticket has expired');
      }

      // Determine public key: use configured trusted central public key or ticket key
      const trustedCentralKey =
        this.configService.get<string>('CENTRAL_ED25519_PUBLIC_KEY') || centralPublicKey;

      if (!trustedCentralKey) {
        throw new UnauthorizedException('Central server public key not configured on school server');
      }

      // Offline Ed25519 cryptographic signature verification
      const canonicalDataString = JSON.stringify(data);
      const messageBytes = naclUtil.decodeUTF8(canonicalDataString);
      const signatureBytes = naclUtil.decodeBase64(signature);
      const publicKeyBytes = naclUtil.decodeBase64(trustedCentralKey);

      const isSignatureValid = nacl.sign.detached.verify(
        messageBytes,
        signatureBytes,
        publicKeyBytes,
      );

      if (!isSignatureValid) {
        throw new UnauthorizedException('Invalid cryptographic signature on federation ticket');
      }

      // Attach verified claims to request context
      request['user'] = {
        centralUserId: data.centralUserId,
        clerkUserId: data.clerkUserId,
        fullName: data.fullName,
        primaryEmail: data.primaryEmail,
        isTrusted: data.isTrusted,
      };

      return true;
    } catch (err) {
      this.logger.warn(`Ticket authentication failure: ${err.message}`);
      throw new UnauthorizedException(`Unauthorized: ${err.message}`);
    }
  }
}
