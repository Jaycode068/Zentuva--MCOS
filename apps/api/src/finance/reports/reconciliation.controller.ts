import { Controller, Get, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { ReconciliationService } from './reconciliation.service';
import { PayablesReconciliationService } from './payables-reconciliation.service';
import { RequirePermission } from '../../identity/auth/decorators/require-permission.decorator';
import { PermissionsGuard } from '../../identity/auth/guards/permissions.guard';

/**
 * Finance Reconciliation HTTP surface — entirely read-only, auth-only, no `RolesGuard`.
 * `reconciliation` is the existing Inventory-to-Ledger report (Sprint 13, docs/domains/
 * accounting.md §16.3). `payables-reconciliation` is the equivalent, additive
 * Payables-to-Ledger report added in Stage 4E.2 — same permission, same org-scoping
 * convention, never touching the existing Inventory route or its behaviour.
 */
@Controller('finance/reports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ReconciliationController {
  constructor(
    private readonly reconciliationService: ReconciliationService,
    private readonly payablesReconciliationService: PayablesReconciliationService,
  ) {}

  @Get('reconciliation')
  @RequirePermission('finance.reports.view')
  async getReconciliation(@CurrentUser() user: TokenPayload) {
    return this.reconciliationService.getInventoryReconciliation(user.organisationId);
  }

  @Get('payables-reconciliation')
  @RequirePermission('finance.reports.view')
  async getPayablesReconciliation(@CurrentUser() user: TokenPayload) {
    return this.payablesReconciliationService.getPayablesReconciliation(user.organisationId);
  }
}
