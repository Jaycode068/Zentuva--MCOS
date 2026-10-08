import { Controller, Get, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { RequirePermission } from '../../identity/auth/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../identity/auth/guards/permissions.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { FieldD2COverviewService } from './field-d2c-overview.service';

/**
 * Sprint 38 — Field Operations & Collection Point Mobile Experience
 * (docs/domains/d2c.md). The Sales Representative's own territory-scoped D2C
 * overview — two read-only endpoints, each reusing the EXISTING permission that
 * already gates the exact kind of data it returns: `d2c.consumer.view` for the order
 * list (`Consumer`/`SalesOrder` data, Sprint 32), `d2c.collection_point.view` for the
 * Collection Point list (`Outlet`/`CollectionPointFulfillment` data, Sprint 37). No
 * genuine authorization gap was found during this sprint's audit that would justify a
 * new permission pair. Territory scoping itself is NOT either permission's
 * `SCOPABLE` grant — it is a server-side resource-ownership check inside
 * `FieldD2COverviewService`, the exact same "permission gates the action, a separate
 * check gates WHICH records" shape `d2c.collection_point.*` already established in
 * Sprint 37 for "my assigned outlet."
 */
@Controller('d2c/field-overview')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FieldD2COverviewController {
  constructor(private readonly service: FieldD2COverviewService) {}

  @Get('orders')
  @RequirePermission('d2c.consumer.view')
  async listOrders(@CurrentUser() user: TokenPayload) {
    const items = await this.service.listOrders(user.organisationId, user.sub);
    return { items };
  }

  @Get('collection-points')
  @RequirePermission('d2c.collection_point.view')
  async listCollectionPoints(@CurrentUser() user: TokenPayload) {
    const items = await this.service.listCollectionPoints(user.organisationId, user.sub);
    return { items };
  }

  /** Added Sprint 43 — the same territory scoping as the two routes above;
   *  `d2c.collection_point.view` since every exception here concerns an order's
   *  Collection Point fulfilment state. */
  @Get('exceptions')
  @RequirePermission('d2c.collection_point.view')
  async listExceptions(@CurrentUser() user: TokenPayload) {
    const items = await this.service.listExceptions(user.organisationId, user.sub);
    return { items };
  }
}
