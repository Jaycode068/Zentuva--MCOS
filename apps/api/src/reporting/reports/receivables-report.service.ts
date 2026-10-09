import { Injectable } from '@nestjs/common';

import { AccountsReceivableService, AgingReport } from '../../finance/accounts-receivable.service';

/**
 * Sprint 45 — Reporting & Business Intelligence Foundation. The Receivables report is
 * a pure pass-through to `AccountsReceivableService.getAgingReport` — the one,
 * already-authoritative aging calculation (docs/domains/finance.md "Accounts
 * Receivable Aging"). This file exists only to give the report its own stable,
 * catalogue-registered entry point; it adds no new calculation (brief §4 "do not
 * create a parallel implementation of a metric that already has an authoritative
 * source").
 */
@Injectable()
export class ReceivablesReportService {
  constructor(private readonly accountsReceivableService: AccountsReceivableService) {}

  getReport(organisationId: string, asOf: Date = new Date()): Promise<AgingReport> {
    return this.accountsReceivableService.getAgingReport(organisationId, asOf);
  }
}
