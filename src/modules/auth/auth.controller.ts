import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { TicketAuthGuard } from '../../common/guards/ticket-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('auth')
@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('me')
  @UseGuards(TicketAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get local user profile on school server',
    description: 'Verifies the Central Server Federation Ticket offline and returns the local student profile.',
  })
  @ApiResponse({ status: 200, description: 'Local user profile' })
  async getProfile(@CurrentUser() user: any) {
    return this.authService.getOrCreateLocalUser(user);
  }

  @Patch('profile')
  @UseGuards(TicketAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update local student profile',
    description: 'Updates personal email, roles (rider/driver), and vehicle information.',
  })
  @ApiResponse({ status: 200, description: 'Updated local profile' })
  async updateProfile(@CurrentUser() user: any, @Body() dto: any) {
    return this.authService.updateProfile(user.centralUserId, dto);
  }
}
