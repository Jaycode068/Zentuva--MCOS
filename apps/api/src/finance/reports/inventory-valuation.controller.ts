import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ProductType } from '@prisma/client';

import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { InventoryValuationService } from './inventory-valuation.service';

/**
 * Inventory Valuation HTTP surface (Sprint 13, docs/domains/accounting.md §16.3).
 * Entirely read-only — auth-only, no `RolesGuard`, Member has full read access.
 */
@Controller('finance/reports')
@UseGuards(JwtAuthGuard)
export class InventoryValuationController {
  constructor(private readonly inventoryValuationService: InventoryValuationService) {}

  @Get('inventory-valuation')
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
