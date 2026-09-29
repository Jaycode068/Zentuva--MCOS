import 'reflect-metadata';
import { join } from 'path';

import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  // `rawBody: true` (Sprint 35) — exposes `req.rawBody` (a `Buffer`)
  // ALONGSIDE the normal parsed `req.body`, needed only by the OPay webhook
  // route to verify the callback's HMAC signature over the exact bytes
  // OPay signed (docs/domains/d2c.md "Webhook Security") — every other
  // route's behaviour is completely unaffected.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
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
