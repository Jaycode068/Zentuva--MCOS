import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { ProductModule } from './catalogue/product/product.module';
import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { AccountModule } from './identity/account/account.module';
import { AuthModule } from './identity/auth/auth.module';
import { HealthModule } from './health/health.module';
import { IdentityModule } from './identity/identity.module';
import { OrganisationModule } from './identity/organisation/organisation.module';
import { SettingsModule } from './identity/settings/settings.module';
import { UserModule } from './identity/user/user.module';
import { PrismaModule } from './prisma/prisma.module';
import { SupplierModule } from './suppliers/supplier/supplier.module';

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
    UserModule,
    AccountModule,
    SettingsModule,
    ProductModule,
    SupplierModule,
  ],
})
export class AppModule {}
