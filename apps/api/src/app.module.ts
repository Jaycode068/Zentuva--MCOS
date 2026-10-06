import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AssetsModule } from './assets/assets.module';
import { ProductModule } from './catalogue/product/product.module';
import { D2CAdminModule } from './d2c/admin/d2c-admin.module';
import { ConsumerModule } from './d2c/consumer/consumer.module';
import { ConversationModule } from './d2c/conversation/conversation.module';
import { CollectionPointFulfillmentModule } from './d2c/fulfillment/collection-point-fulfillment.module';
import { FieldD2COverviewModule } from './d2c/field-overview/field-d2c-overview.module';
import { ProductFamilyModule } from './catalogue/product-family/product-family.module';
import { ProductVariantModule } from './catalogue/product-variant/product-variant.module';
import { LoyaltyModule } from './promotions/loyalty/loyalty.module';
import { PromotionModule } from './promotions/promotion/promotion.module';
import { RewardModule } from './promotions/reward/reward.module';
import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { AccountModule } from './identity/account/account.module';
import { AuthModule } from './identity/auth/auth.module';
import { AccessControlModule } from './access-control/access-control.module';
import { HealthModule } from './health/health.module';
import { HrModule } from './hr/hr.module';
import { RecruitmentModule } from './hr/recruitment/recruitment.module';
import { IdentityModule } from './identity/identity.module';
import { OrganisationModule } from './identity/organisation/organisation.module';
import { SettingsModule } from './identity/settings/settings.module';
import { UserModule } from './identity/user/user.module';
import { InventoryModule } from './inventory/inventory.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { PrismaModule } from './prisma/prisma.module';
import { DistributionModule } from './distribution/distribution.module';
import { FinanceModule } from './finance/finance.module';
import { PurchaseOrderModule } from './procurement/purchase-order/purchase-order.module';
import { ProductionModule } from './production/production.module';
import { CustomerModule } from './retail/customer/customer.module';
import { NetworkRelationshipModule } from './retail/network/network-relationship.module';
import { OutletModule } from './retail/outlet/outlet.module';
import { TerritoryModule } from './retail/territory/territory.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SalesModule } from './sales/sales.module';
import { SupplierModule } from './suppliers/supplier/supplier.module';
import { WorkflowModule } from './workflow/workflow.module';
import { PaymentsModule } from './payments/payments.module';

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
    ProductFamilyModule,
    ProductVariantModule,
    SupplierModule,
    PurchaseOrderModule,
    InventoryModule,
    ProductionModule,
    TerritoryModule,
    CustomerModule,
    OutletModule,
    NetworkRelationshipModule,
    SalesModule,
    DistributionModule,
    FinanceModule,
    AssetsModule,
    MaintenanceModule,
    HrModule,
    RecruitmentModule,
    ConsumerModule,
    ConversationModule,
    PaymentsModule,
    CollectionPointFulfillmentModule,
    FieldD2COverviewModule,
    D2CAdminModule,
    PromotionModule,
    LoyaltyModule,
    RewardModule,
    AccessControlModule,
    WorkflowModule,
    NotificationsModule,
  ],
})
export class AppModule {}
