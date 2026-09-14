import { Controller, Get, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { ReconciliationService } from './reconciliation.service';
import { RequirePermission } from '../../identity/auth/decorators/require-permission.decorator';
import { PermissionsGuard } from '../../identity/auth/guards/permissions.guard';

/**
 * Inventory-to-Ledger Reconciliation HTTP surface (Sprint 13, docs/domains/
 * accounting.md §16.3). Entirely read-only — auth-only, no `RolesGuard`.
 */
@Controller('finance/reports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ReconciliationController {
  constructor(private readonly reconciliationService: ReconciliationService) {}

  @Get('reconciliation')
  @RequirePermission('finance.reports.view')
  async getReconciliation(@CurrentUser() user: TokenPayload) {
    return this.reconciliationService.getInventoryReconciliation(user.organisationId);
  }
}
