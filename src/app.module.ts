import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { MetadataModule } from './modules/metadata/metadata.module';
import { AuthModule } from './modules/auth/auth.module';
import { VerificationModule } from './modules/verification/verification.module';
import { HomesModule } from './modules/homes/homes.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { MatchingModule } from './modules/matching/matching.module';
import { NegotiationModule } from './modules/negotiation/negotiation.module';
import { CarpoolsModule } from './modules/carpools/carpools.module';
import { GatewayModule } from './modules/gateway/gateway.module';

/**
 * AppModule
 * 
 * Root NestJS module for the Carpschool Autonomous School Server.
 * Configures connection to the isolated school_db MongoDB container over school_internal_network.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.local'],
    }),

    // Mongoose MongoDB connection (isolated internal container network, no auth)
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>(
          'MONGO_URI',
          'mongodb://school-mongo:27017/school_db',
        ),
      }),
      inject: [ConfigService],
    }),

    // Domain modules
    MetadataModule,
    AuthModule,
    VerificationModule,
    HomesModule,
    ApplicationsModule,
    MatchingModule,
    NegotiationModule,
    CarpoolsModule,
    GatewayModule,
  ],
})
export class AppModule {}
