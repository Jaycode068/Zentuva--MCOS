import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ConsumerStatus, PaymentStatus, SalesOrderStatus } from '@prisma/client';
import { paginationSchema } from '@zentuva/validation';

import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { RequirePermission } from '../../identity/auth/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../identity/auth/guards/permissions.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { toSalesOrderResponse } from '../../sales/sales-order.controller';
import { toConsumerResponse } from '../consumer/consumer.controller';
import { D2CAdminService } from './d2c-admin.service';

/**
 * Sprint 39 — D2C Sales Administration & Operations Dashboard HTTP surface
 * (docs/domains/d2c.md). Every route additionally re-asserts an admin-only check
 * inside `D2CAdminService` (the same `sales.customer.manage`-or-owner-bypass signal
 * `CollectionPointFulfillmentService` already established) — the `@RequirePermission`
 * decorators below only establish that the caller holds the right KIND of permission at
 * all, never that they hold it with organisation-wide scope.
 *
 * The D2C Order list/detail and Consumer detail themselves are NOT duplicated here —
 * `GET /sales/orders` (widened Sprint 39 with `source`/pagination/date-range) and
 * `GET /d2c/consumers/:id` (existing, Sprint 32) remain the single source for those
 * reads; this controller only adds the aggregate views no existing endpoint already
 * provides (overview, attention, territory summary) plus the Consumer admin list's own
 * paginated variant.
 */
@Controller('d2c/admin')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class D2CAdminController {
  constructor(private readonly service: D2CAdminService) {}

  @Get('overview')
  @RequirePermission('sales.order.view')
  async getOverview(@CurrentUser() user: TokenPayload) {
    return this.service.getOverview(user.organisationId, user.sub);
  }

  @Get('attention')
  @RequirePermission('sales.order.view')
  async getAttention(@CurrentUser() user: TokenPayload) {
    const items = await this.service.getAttention(user.organisationId, user.sub);
    return { items };
  }

  @Get('territories')
  @RequirePermission('sales.order.view')
  async getTerritorySummary(@CurrentUser() user: TokenPayload) {
    const items = await this.service.getTerritorySummary(user.organisationId, user.sub);
    return { items };
  }

  @Get('consumers')
  @RequirePermission('d2c.consumer.view')
  async listConsumers(
    @CurrentUser() user: TokenPayload,
    @Query('page') pageRaw?: string,
    @Query('pageSize') pageSizeRaw?: string,
    @Query('status') status?: ConsumerStatus,
    @Query('territoryId') territoryId?: string,
    @Query('search') search?: string,
  ) {
    const { page, pageSize } = paginationSchema.parse({ page: pageRaw, pageSize: pageSizeRaw });
    const { items, total } = await this.service.listConsumers(user.organisationId, user.sub, {
      status,
      territoryId,
      search: search?.trim() || undefined,
      page,
      pageSize,
    });
    return { items: items.map(toConsumerResponse), total, page, pageSize };
  }

  @Get('orders')
  @RequirePermission('sales.order.view')
  async listOrders(
    @CurrentUser() user: TokenPayload,
    @Query('page') pageRaw?: string,
    @Query('pageSize') pageSizeRaw?: string,
    @Query('status') status?: SalesOrderStatus,
    @Query('consumerId') consumerId?: string,
    @Query('territoryId') consumerTerritoryId?: string,
    @Query('collectionPointOutletId') collectionPointOutletId?: string,
    @Query('paymentStatus') paymentStatus?: PaymentStatus | 'NONE',
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('search') search?: string,
  ) {
    const { page, pageSize } = paginationSchema.parse({ page: pageRaw, pageSize: pageSizeRaw });
    const { items, total } = await this.service.listOrders(user.organisationId, user.sub, {
      status,
      consumerId,
      consumerTerritoryId,
      collectionPointOutletId,
      paymentStatus,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      search: search?.trim() || undefined,
      page,
      pageSize,
    });
    return { items: items.map(toSalesOrderResponse), total, page, pageSize };
  }
}
