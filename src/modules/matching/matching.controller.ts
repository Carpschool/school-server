import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { MatchingService } from './matching.service';
import { CommuteDirection } from '../applications/schemas/rider-application.schema';
import { TicketAuthGuard } from '../../common/guards/ticket-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('matching')
@Controller('api/v1/matching')
@UseGuards(TicketAuthGuard)
@ApiBearerAuth()
export class MatchingController {
  constructor(private readonly matchingService: MatchingService) {}

  @Get('riders')
  @ApiOperation({
    summary: 'Driver searches for nearby rider applications along commute corridor',
    description: 'Returns available rider applications sorted by spatial proximity to the driver home.',
  })
  @ApiQuery({ name: 'direction', enum: CommuteDirection })
  @ApiQuery({ name: 'driverHomeId', type: String })
  async getMatchingRiders(
    @CurrentUser() user: any,
    @Query('direction') direction: CommuteDirection,
    @Query('driverHomeId') driverHomeId: string,
  ) {
    return this.matchingService.findMatchingRiders(user.centralUserId, {
      direction,
      driverHomeId,
    });
  }
}
