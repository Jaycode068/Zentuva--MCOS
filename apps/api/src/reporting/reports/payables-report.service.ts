import { Injectable } from '@nestjs/common';

import { AccountsPayableService, ApAgingReport } from '../../finance/accounts-payable.service';

/**
 * Sprint 45 — Reporting & Business Intelligence Foundation. Pure pass-through to
 * `AccountsPayableService.getAgingReport` — same rationale as
 * `ReceivablesReportService`: one authoritative source, this file only registers it
 * as a catalogue report.
 */
@Injectable()
export class PayablesReportService {
  constructor(private readonly accountsPayableService: AccountsPayableService) {}

  getReport(organisationId: string, asOf: Date = new Date()): Promise<ApAgingReport> {
    return this.accountsPayableService.getAgingReport(organisationId, asOf);
  }
}
