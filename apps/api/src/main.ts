import 'reflect-metadata';
import { join } from 'path';

import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const logger = new Logger('Bootstrap');
  const config = app.get(ConfigService);

  app.enableCors();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('api');

  // Sprint 3.4 — serves locally-uploaded logos (LocalFileStorage) at
  // /api/uploads/<key>. Excluded from the global 'api' prefix logic above since
  // useStaticAssets mounts its own route directly.
  app.useStaticAssets(join(process.cwd(), config.get<string>('uploads.dir', 'uploads')), {
    prefix: '/api/uploads/',
  });

  const port = config.get<number>('port') ?? 4000;
  await app.listen(port);
  logger.log(`Zentuva API listening on port ${port}`);
}

bootstrap();
