import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { AuthModule } from './identity/auth/auth.module';
import { HealthModule } from './health/health.module';
import { IdentityModule } from './identity/identity.module';
import { OrganisationModule } from './identity/organisation/organisation.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
    }),
    PrismaModule,
    HealthModule,
    IdentityModule,
    AuthModule,
    OrganisationModule,
  ],
})
export class AppModule {}
