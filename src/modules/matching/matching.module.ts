import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { HomesModule } from '../homes/homes.module';
import { ApplicationsModule } from '../applications/applications.module';
import { MatchingService } from './matching.service';
import { MatchingController } from './matching.controller';

@Module({
  imports: [AuthModule, HomesModule, ApplicationsModule],
  controllers: [MatchingController],
  providers: [MatchingService],
  exports: [MatchingService],
})
export class MatchingModule {}
