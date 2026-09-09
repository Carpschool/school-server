import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TicketAuthGuard } from './ticket-auth.guard';
import * as nacl from 'tweetnacl';
import * as naclUtil from 'tweetnacl-util';

describe('TicketAuthGuard', () => {
  let guard: TicketAuthGuard;
  let centralKeyPair: nacl.SignKeyPair;
  let centralPublicKeyBase64: string;

  beforeEach(() => {
    centralKeyPair = nacl.sign.keyPair();
    centralPublicKeyBase64 = naclUtil.encodeBase64(centralKeyPair.publicKey);

    const configService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        if (key === 'CENTRAL_ED25519_PUBLIC_KEY') return centralPublicKeyBase64;
        if (key === 'NODE_ENV') return 'production';
        return defaultValue;
      }),
    } as unknown as ConfigService;

    guard = new TicketAuthGuard(configService);
  });

  function createMockExecutionContext(authHeader?: string) {
    const request: any = {
      headers: authHeader ? { authorization: authHeader } : {},
    };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      request,
    };
  }

  function signTicket(data: any) {
    const canonicalString = JSON.stringify(data);
    const signatureBytes = nacl.sign.detached(
      naclUtil.decodeUTF8(canonicalString),
      centralKeyPair.secretKey,
    );
    const signature = naclUtil.encodeBase64(signatureBytes);

    const tokenPackage = {
      data,
      signature,
      centralPublicKey: centralPublicKeyBase64,
    };

    return Buffer.from(JSON.stringify(tokenPackage)).toString('base64');
  }

  it('should allow valid ticket verified locally and offline with zero network calls', async () => {
    const validTicketData = {
      centralUserId: 'usr_student_01',
      clerkUserId: 'clerk_01',
      fullName: 'John Student',
      primaryEmail: 'john@carpschool.ca',
      schoolCode: 'ubc',
      isTrusted: true,
      expiresAt: new Date(Date.now() + 86400 * 1000).toISOString(),
    };

    const tokenBase64 = signTicket(validTicketData);
    const { request, ...context } = createMockExecutionContext(`Bearer ${tokenBase64}`);

    const result = await guard.canActivate(context as any);
    expect(result).toBe(true);
    expect(request.user).toBeDefined();
    expect(request.user.centralUserId).toBe('usr_student_01');
    expect(request.user.isTrusted).toBe(true);
  });

  it('should reject expired ticket', async () => {
    const expiredTicketData = {
      centralUserId: 'usr_student_02',
      clerkUserId: 'clerk_02',
      fullName: 'Expired Student',
      primaryEmail: 'expired@carpschool.ca',
      schoolCode: 'ubc',
      isTrusted: true,
      expiresAt: new Date(Date.now() - 1000).toISOString(), // Expired 1 second ago
    };

    const tokenBase64 = signTicket(expiredTicketData);
    const context = createMockExecutionContext(`Bearer ${tokenBase64}`);

    await expect(guard.canActivate(context as any)).rejects.toThrow(UnauthorizedException);
  });

  it('should reject tampered ticket payload', async () => {
    const validTicketData = {
      centralUserId: 'usr_student_03',
      clerkUserId: 'clerk_03',
      fullName: 'Legit Student',
      primaryEmail: 'student@carpschool.ca',
      schoolCode: 'ubc',
      isTrusted: true,
      expiresAt: new Date(Date.now() + 86400 * 1000).toISOString(),
    };

    const tokenBase64 = signTicket(validTicketData);
    // Tamper with decoded JSON
    const decoded = JSON.parse(Buffer.from(tokenBase64, 'base64').toString('utf8'));
    decoded.data.centralUserId = 'usr_attacker_99'; // Tampered!
    const tamperedBase64 = Buffer.from(JSON.stringify(decoded)).toString('base64');

    const context = createMockExecutionContext(`Bearer ${tamperedBase64}`);

    await expect(guard.canActivate(context as any)).rejects.toThrow(UnauthorizedException);
  });

  it('should reject request with missing Authorization header', async () => {
    const context = createMockExecutionContext();
    await expect(guard.canActivate(context as any)).rejects.toThrow(UnauthorizedException);
  });
});
