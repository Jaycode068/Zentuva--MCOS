import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ProductType } from '@prisma/client';

import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { InventoryValuationService } from './inventory-valuation.service';
import { RequirePermission } from '../../identity/auth/decorators/require-permission.decorator';
import { PermissionsGuard } from '../../identity/auth/guards/permissions.guard';

/**
 * Inventory Valuation HTTP surface (Sprint 13, docs/domains/accounting.md §16.3).
 * Entirely read-only — auth-only, no `RolesGuard`, Member has full read access.
 */
@Controller('finance/reports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class InventoryValuationController {
  constructor(private readonly inventoryValuationService: InventoryValuationService) {}

  @Get('inventory-valuation')
  @RequirePermission('finance.reports.view')
  async getInventoryValuation(
    @CurrentUser() user: TokenPayload,
    @Query('locationId') locationId?: string,
    @Query('productType') productType?: ProductType,
  ) {
    return this.inventoryValuationService.getValuation(user.organisationId, {
      locationId,
      productType,
    });
  }
}
