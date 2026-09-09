import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('SchoolServerBootstrap');
  const app = await NestFactory.create(AppModule);

  // Enable CORS for web client, iOS, and Android
  app.enableCors({
    origin: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
    exposedHeaders: ['x-school-signature'],
  });

  // Global DTO validation with class-validator
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Configure Swagger OpenAPI interactive documentation
  const config = new DocumentBuilder()
    .setTitle('Carpschool Autonomous School Server API')
    .setDescription(
      'REST API documentation for School Server. Handles offline Ed25519 Federation Ticket auth, .edu email verification, corridor matching, in-chat pickup negotiations, 4-digit boarding PIN validation, and discrete GPS snapshots.',
    )
    .setVersion('2.0.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 5000;
  await app.listen(port);

  logger.log(`🏫 School Server running on http://localhost:${port}`);
  logger.log(`📚 Swagger API Documentation available at http://localhost:${port}/api/docs`);
  logger.log(`🔏 Public signed metadata endpoint: http://localhost:${port}/api/v1/meta`);
}

bootstrap();
