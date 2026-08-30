import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../identity/auth/guards/jwt-auth.guard';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { AccountsPayableService } from './accounts-payable.service';

/**
 * Accounts Payable HTTP surface (Sprint 12, docs/domains/finance.md "Accounts
 * Payable") — read-only reporting, auth-only (Member can see it, same as every other
 * domain's read routes).
 */
@Controller('finance/accounts-payable')
@UseGuards(JwtAuthGuard)
export class AccountsPayableController {
  constructor(private readonly accountsPayableService: AccountsPayableService) {}

  @Get('summary')
  async summary(@CurrentUser() user: TokenPayload) {
    return this.accountsPayableService.getSummary(user.organisationId);
  }

  @Get('by-supplier')
  async bySupplier(@CurrentUser() user: TokenPayload) {
    const items = await this.accountsPayableService.listBySupplier(user.organisationId);
    return { items };
  }

  @Get('aging')
  async aging(@CurrentUser() user: TokenPayload, @Query('asOf') asOf?: string) {
    return this.accountsPayableService.getAgingReport(
      user.organisationId,
      asOf ? new Date(asOf) : undefined,
    );
  }

  @Get('suppliers/:supplierId')
  async supplierBalance(
    @CurrentUser() user: TokenPayload,
    @Param('supplierId') supplierId: string,
  ) {
    return this.accountsPayableService.getSupplierFinancialSummary(user.organisationId, supplierId);
  }

  @Get('purchase-orders/:purchaseOrderId')
  async purchaseOrderSummary(
    @CurrentUser() user: TokenPayload,
    @Param('purchaseOrderId') purchaseOrderId: string,
  ) {
    return this.accountsPayableService.getPurchaseOrderFinancialSummary(
      user.organisationId,
      purchaseOrderId,
    );
  }
}
