import { Controller, Post, Get, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CarpoolsService } from './carpools.service';
import { SubmitBoardingPinDto } from './dto/boarding-pin.dto';
import { EndRideDto } from './dto/end-ride.dto';
import { TicketAuthGuard } from '../../common/guards/ticket-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('carpools')
@Controller('api/v1/carpools')
@UseGuards(TicketAuthGuard)
@ApiBearerAuth()
export class CarpoolsController {
  constructor(private readonly carpoolsService: CarpoolsService) {}

  @Get(':id')
  @ApiOperation({ summary: 'Get carpool details and passenger roster' })
  async getCarpool(@Param('id') id: string) {
    return this.carpoolsService.getCarpool(id);
  }

  @Post(':id/board-passenger')
  @ApiOperation({
    summary: 'Driver submits passenger 4-digit PIN with single GPS coordinate snapshot',
  })
  async submitBoardingPin(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: SubmitBoardingPinDto,
  ) {
    return this.carpoolsService.submitBoardingPin(user.centralUserId, id, dto);
  }

  @Post(':id/end-ride')
  @ApiOperation({
    summary: 'Driver completes carpool with single GPS coordinate snapshot at destination',
  })
  async endRide(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: EndRideDto,
  ) {
    return this.carpoolsService.endRide(user.centralUserId, id, dto);
  }
}
