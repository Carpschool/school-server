import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

/**
 * EmailService for Autonomous School Server.
 * 
 * Dispatches institutional .edu verification OTP codes to students.
 * Supports:
 *  1. Gmail OAuth2 (type: 'OAuth2' with Client ID, Secret, and Refresh Token)
 *  2. Gmail App Password (service: 'gmail' with 16-character App Password)
 *  3. Standard SMTP Relay
 *  4. Development Mock (logs OTP code to stdout for local testing)
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly configService: ConfigService) {
    this.initializeTransporter();
  }

  private initializeTransporter(): void {
    const gmailUser = this.configService.get<string>('GMAIL_USER');
    const gmailAppPassword = this.configService.get<string>('GMAIL_APP_PASSWORD');
    const oauthClientId = this.configService.get<string>('GMAIL_OAUTH_CLIENT_ID');
    const oauthClientSecret = this.configService.get<string>('GMAIL_OAUTH_CLIENT_SECRET');
    const oauthRefreshToken = this.configService.get<string>('GMAIL_OAUTH_REFRESH_TOKEN');

    // 1. Gmail OAuth2
    if (gmailUser && oauthClientId && oauthClientSecret && oauthRefreshToken) {
      this.logger.log(`📧 Configuring Gmail OAuth2 transport for ${gmailUser}`);
      this.transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          type: 'OAuth2',
          user: gmailUser,
          clientId: oauthClientId,
          clientSecret: oauthClientSecret,
          refreshToken: oauthRefreshToken,
        },
      });
      return;
    }

    // 2. Gmail App Password
    if (gmailUser && gmailAppPassword) {
      this.logger.log(`📧 Configuring Gmail App Password SMTP transport for ${gmailUser}`);
      this.transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: gmailUser,
          pass: gmailAppPassword.replace(/\s+/g, ''),
        },
      });
      return;
    }

    // 3. Generic SMTP
    const smtpHost = this.configService.get<string>('SMTP_HOST');
    const smtpUser = this.configService.get<string>('SMTP_USER');
    const smtpPass = this.configService.get<string>('SMTP_PASS');
    if (smtpHost && smtpUser && smtpPass) {
      const smtpPort = parseInt(this.configService.get<string>('SMTP_PORT', '587'), 10);
      this.logger.log(`📧 Configuring SMTP transport (${smtpHost}:${smtpPort}) for ${smtpUser}`);
      this.transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });
      return;
    }

    // 4. Fallback: Development Mock
    this.logger.log('📧 Using Mock Email provider (codes logged directly to console).');
    this.transporter = null;
  }

  /**
   * Dispatches a 6-digit .edu verification OTP email.
   */
  async sendEduVerificationCode(
    toEmail: string,
    code: string,
    schoolName: string = 'Campus Carpool',
  ): Promise<boolean> {
    const sender =
      this.configService.get<string>('GMAIL_USER') ||
      this.configService.get<string>('SMTP_USER') ||
      'security@carpschool.ca';

    // Mock Mode fallback
    if (!this.transporter) {
      this.logger.log(
        `📧 [MOCK EMAIL] From: ${sender} | To: ${toEmail} | Code: ${code} | School: ${schoolName}`,
      );
      return true;
    }

    try {
      await this.transporter.sendMail({
        from: `"${schoolName} Carpool" <${sender}>`,
        to: toEmail,
        subject: `Your ${schoolName} Carpool Verification Code: ${code}`,
        text: `Hello,\n\nYour verification code for ${schoolName} Carpschool is: ${code}\n\nThis code will expire in 15 minutes. For security, please do not share this code with anyone.\n\n- ${schoolName} Carpschool Team`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px;">
            <h2 style="color: #0f172a; margin-top: 0;">Institutional Campus Verification</h2>
            <p style="color: #475569; font-size: 14px;">
              You requested to verify your institutional email address for <strong>${schoolName}</strong> on the Carpschool campus ridesharing network.
            </p>
            <div style="background-color: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 18px; text-align: center; margin: 24px 0;">
              <span style="font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #2563eb; font-family: monospace;">${code}</span>
            </div>
            <p style="color: #64748b; font-size: 12px; margin-bottom: 0;">
              This code is valid for 15 minutes. If you did not request this verification, you can safely ignore this email.
            </p>
          </div>
        `,
      });

      this.logger.log(`✅ Email successfully delivered to ${toEmail}`);
      return true;
    } catch (err: any) {
      this.logger.error(`❌ Failed to deliver email to ${toEmail}: ${err.message}`);
      // Fallback: log code so development/testing is not stuck if credentials fail
      this.logger.warn(`[FALLBACK LOG] Code for ${toEmail} was: ${code}`);
      return false;
    }
  }
}
