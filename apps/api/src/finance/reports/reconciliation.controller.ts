import { Controller, Get, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { ReconciliationService } from './reconciliation.service';

/**
 * Inventory-to-Ledger Reconciliation HTTP surface (Sprint 13, docs/domains/
 * accounting.md §16.3). Entirely read-only — auth-only, no `RolesGuard`.
 */
@Controller('finance/reports')
@UseGuards(JwtAuthGuard)
export class ReconciliationController {
  constructor(private readonly reconciliationService: ReconciliationService) {}

  @Get('reconciliation')
  async getReconciliation(@CurrentUser() user: TokenPayload) {
    return this.reconciliationService.getInventoryReconciliation(user.organisationId);
  }
}
