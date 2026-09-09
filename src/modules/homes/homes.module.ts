import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserHome, UserHomeSchema } from './schemas/user-home.schema';
import { AuthModule } from '../auth/auth.module';
import { HomesService } from './homes.service';
import { HomesController } from './homes.controller';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([{ name: UserHome.name, schema: UserHomeSchema }]),
  ],
  controllers: [HomesController],
  providers: [HomesService],
  exports: [HomesService, MongooseModule],
})
export class HomesModule {}
