import { Controller, Post, Get, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { HomesService } from './homes.service';
import { CreateHomeDto } from './dto/create-home.dto';
import { TicketAuthGuard } from '../../common/guards/ticket-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('homes')
@Controller('api/v1/homes')
@UseGuards(TicketAuthGuard)
@ApiBearerAuth()
export class HomesController {
  constructor(private readonly homesService: HomesService) {}

  @Post()
  @ApiOperation({
    summary: 'Save a home/dorm address with walking radius (10m - 200m)',
  })
  async createHome(@CurrentUser() user: any, @Body() dto: CreateHomeDto) {
    return this.homesService.createHome(user.centralUserId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List user saved home locations' })
  async listHomes(@CurrentUser() user: any) {
    return this.homesService.listHomes(user.centralUserId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a saved home location' })
  async deleteHome(@CurrentUser() user: any, @Param('id') id: string) {
    return this.homesService.deleteHome(user.centralUserId, id);
  }
}
