import { Controller, Post, Get, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ApplicationsService } from './applications.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import { TicketAuthGuard } from '../../common/guards/ticket-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('applications')
@Controller('api/v1/applications')
@UseGuards(TicketAuthGuard)
@ApiBearerAuth()
export class ApplicationsController {
  constructor(private readonly applicationsService: ApplicationsService) {}

  @Post()
  @ApiOperation({
    summary: 'Rider posts a Carpool Application (Direction, Schedule, Walking Radius)',
  })
  async createApplication(
    @CurrentUser() user: any,
    @Body() dto: CreateApplicationDto,
  ) {
    return this.applicationsService.createApplication(user.centralUserId, dto);
  }

  @Get('my')
  @ApiOperation({ summary: 'List current user applications' })
  async listMyApplications(@CurrentUser() user: any) {
    return this.applicationsService.listMyApplications(user.centralUserId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Cancel a posted application' })
  async cancelApplication(@CurrentUser() user: any, @Param('id') id: string) {
    return this.applicationsService.cancelApplication(user.centralUserId, id);
  }
}
