import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  RiderApplication,
  RiderApplicationSchema,
} from './schemas/rider-application.schema';
import { AuthModule } from '../auth/auth.module';
import { HomesModule } from '../homes/homes.module';
import { ApplicationsService } from './applications.service';
import { ApplicationsController } from './applications.controller';

@Module({
  imports: [
    AuthModule,
    HomesModule,
    MongooseModule.forFeature([
      { name: RiderApplication.name, schema: RiderApplicationSchema },
    ]),
  ],
  controllers: [ApplicationsController],
  providers: [ApplicationsService],
  exports: [ApplicationsService, MongooseModule],
})
export class ApplicationsModule {}
