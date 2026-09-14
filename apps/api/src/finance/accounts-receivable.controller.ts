import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../identity/auth/guards/jwt-auth.guard';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { AccountsReceivableService } from './accounts-receivable.service';
import { RequirePermission } from '../identity/auth/decorators/require-permission.decorator';
import { PermissionsGuard } from '../identity/auth/guards/permissions.guard';

/**
 * Accounts Receivable HTTP surface (Sprint 6, docs/domains/finance.md) — read-only
 * reporting, auth-only (Member can see it, same as every other domain's read routes).
 */
@Controller('finance/receivables')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AccountsReceivableController {
  constructor(private readonly accountsReceivableService: AccountsReceivableService) {}

  @Get('summary')
  @RequirePermission('finance.invoice.view')
  async summary(@CurrentUser() user: TokenPayload) {
    return this.accountsReceivableService.getSummary(user.organisationId);
  }

  @Get('by-customer')
  @RequirePermission('finance.invoice.view')
  async byCustomer(@CurrentUser() user: TokenPayload) {
    const items = await this.accountsReceivableService.listByCustomer(user.organisationId);
    return { items };
  }

  @Get('aging')
  @RequirePermission('finance.invoice.view')
  async aging(@CurrentUser() user: TokenPayload, @Query('asOf') asOf?: string) {
    return this.accountsReceivableService.getAgingReport(
      user.organisationId,
      asOf ? new Date(asOf) : undefined,
    );
  }

  @Get('customers/:customerId')
  @RequirePermission('finance.invoice.view')
  async customerBalance(
    @CurrentUser() user: TokenPayload,
    @Param('customerId') customerId: string,
  ) {
    return this.accountsReceivableService.getCustomerBalance(user.organisationId, customerId);
  }
}
