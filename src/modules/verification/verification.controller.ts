import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, Length } from 'class-validator';
import { VerificationService } from './verification.service';
import { TicketAuthGuard } from '../../common/guards/ticket-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

class SendCodeDto {
  @ApiProperty({ description: 'Institutional .edu email address', example: 'student@cs.ubc.ca' })
  @IsEmail()
  @IsNotEmpty()
  eduEmail: string;
}

class VerifyCodeDto {
  @ApiProperty({ description: '6-digit numeric verification code', example: '482910' })
  @IsString()
  @Length(6, 6)
  code: string;
}

@ApiTags('verification')
@Controller('api/v1/auth/edu')
export class VerificationController {
  constructor(private readonly verificationService: VerificationService) {}

  @Post('send-code')
  @UseGuards(TicketAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Send 6-digit verification code to student institutional email' })
  async sendCode(@CurrentUser() user: any, @Body() dto: SendCodeDto) {
    return this.verificationService.sendCode(user.centralUserId, dto.eduEmail);
  }

  @Post('verify-code')
  @UseGuards(TicketAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Submit 6-digit code to complete institutional .edu verification' })
  async verifyCode(@CurrentUser() user: any, @Body() dto: VerifyCodeDto) {
    return this.verificationService.verifyCode(user.centralUserId, dto.code);
  }
}
