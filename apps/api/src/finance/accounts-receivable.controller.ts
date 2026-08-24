import { Controller, Get, Param, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../identity/auth/guards/jwt-auth.guard';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { AccountsReceivableService } from './accounts-receivable.service';

/**
 * Accounts Receivable HTTP surface (Sprint 6, docs/domains/finance.md) — read-only
 * reporting, auth-only (Member can see it, same as every other domain's read routes).
 */
@Controller('finance/receivables')
@UseGuards(JwtAuthGuard)
export class AccountsReceivableController {
  constructor(private readonly accountsReceivableService: AccountsReceivableService) {}

  @Get('summary')
  async summary(@CurrentUser() user: TokenPayload) {
    return this.accountsReceivableService.getSummary(user.organisationId);
  }

  @Get('by-customer')
  async byCustomer(@CurrentUser() user: TokenPayload) {
    const items = await this.accountsReceivableService.listByCustomer(user.organisationId);
    return { items };
  }

  @Get('customers/:customerId')
  async customerBalance(
    @CurrentUser() user: TokenPayload,
    @Param('customerId') customerId: string,
  ) {
    return this.accountsReceivableService.getCustomerBalance(user.organisationId, customerId);
  }
}
