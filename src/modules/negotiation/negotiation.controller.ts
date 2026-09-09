import { Controller, Post, Get, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import { NegotiationService } from './negotiation.service';
import { SuggestPickupDto } from './dto/suggest-pickup.dto';
import { TicketAuthGuard } from '../../common/guards/ticket-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

class SendMessageDto {
  @ApiProperty({ description: 'Message text content' })
  @IsString()
  @IsNotEmpty()
  text: string;
}

class RespondProposalDto {
  @ApiProperty({ enum: ['CONFIRM', 'DENY'], description: 'Accept or decline the proposed pickup spot' })
  @IsIn(['CONFIRM', 'DENY'])
  action: 'CONFIRM' | 'DENY';
}

@ApiTags('negotiation')
@Controller('api/v1/negotiations')
@UseGuards(TicketAuthGuard)
@ApiBearerAuth()
export class NegotiationController {
  constructor(private readonly negotiationService: NegotiationService) {}

  @Post('start/:applicationId')
  @ApiOperation({ summary: 'Driver initiates contact with a rider application' })
  async startNegotiation(
    @CurrentUser() user: any,
    @Param('applicationId') applicationId: string,
  ) {
    return this.negotiationService.startNegotiation(user.centralUserId, applicationId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get full negotiation history, messages, and proposal cards' })
  async getNegotiation(@Param('id') id: string) {
    return this.negotiationService.getNegotiation(id);
  }

  @Post(':id/message')
  @ApiOperation({ summary: 'Send a chat message' })
  async sendMessage(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.negotiationService.sendMessage(user.centralUserId, id, dto.text);
  }

  @Post(':id/propose-pickup')
  @ApiOperation({
    summary: 'Suggest a pickup point and time from in-chat Location Modal',
  })
  async suggestPickupPoint(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: SuggestPickupDto,
  ) {
    return this.negotiationService.suggestPickupPoint(user.centralUserId, id, dto);
  }

  @Post(':id/proposals/:proposalId/respond')
  @ApiOperation({ summary: 'Confirm or Deny a proposed pickup location card' })
  async respondProposal(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Param('proposalId') proposalId: string,
    @Body() dto: RespondProposalDto,
  ) {
    return this.negotiationService.respondToProposal(
      user.centralUserId,
      id,
      proposalId,
      dto.action,
    );
  }

  @Post(':id/lock-in')
  @ApiOperation({
    summary: 'Lock in carpool, atomically reserve seat, and issue 4-digit Boarding PIN',
  })
  async lockInCarpool(@CurrentUser() user: any, @Param('id') id: string) {
    return this.negotiationService.lockInCarpool(user.centralUserId, id);
  }
}
