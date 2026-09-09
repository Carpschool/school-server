import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Carpool, CarpoolSchema } from './schemas/carpool.schema';
import { LocalUser, LocalUserSchema } from '../auth/schemas/local-user.schema';
import { CarpoolsService } from './carpools.service';
import { CarpoolsController } from './carpools.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Carpool.name, schema: CarpoolSchema },
      { name: LocalUser.name, schema: LocalUserSchema },
    ]),
  ],
  controllers: [CarpoolsController],
  providers: [CarpoolsService],
  exports: [CarpoolsService],
})
export class CarpoolsModule {}
