import { Injectable } from '@nestjs/common';

import { SalesFulfilmentRepository } from '../../sales/sales-fulfilment.repository';
import { InvoiceRepository } from '../invoice.repository';
import { FinancialStatementService } from './financial-statement.service';

export interface RevenueByProductRow {
  productId: string | null;
  productName: string;
  totalRevenue: number;
}

export interface RevenueByCustomerRow {
  customerId: string;
  customerName: string;
  totalRevenue: number;
}

export interface RevenueReport {
  from: Date | null;
  to: Date;
  /** The GL-tied headline figure — `FinancialStatementService.getProfitAndLoss()`'s
   *  own `revenue` (net of `SALES_RETURNS`). The breakdowns below are a
   *  supplementary drill-down sourced from `Invoice`/`InvoiceItem` directly, not a
   *  second source of truth for this number (docs/domains/accounting.md §16.4). */
  totalRevenue: number;
  byProduct: RevenueByProductRow[];
  byCustomer: RevenueByCustomerRow[];
}

export interface CogsByProductRow {
  /** No denormalized product name on `SalesFulfilmentItem` (unlike `InvoiceItem`) —
   *  the frontend resolves this against its own already-fetched product list rather
   *  than Finance adding a new Catalogue dependency for one display label. */
  productId: string;
  totalCogs: number;
}

export interface CogsReport {
  from: Date | null;
  to: Date;
  /** The GL-tied headline figure — `FinancialStatementService.getProfitAndLoss()`'s
   *  own `costOfSales`. */
  totalCogs: number;
  byProduct: CogsByProductRow[];
}

/**
 * Revenue and COGS reporting (Sprint 13, docs/domains/accounting.md §16.4) — the
 * headline totals always come from `FinancialStatementService`'s own GL-derived P&L
 * (never recomputed independently here); the by-product/by-customer breakdowns are
 * supplementary drill-downs sourced from Finance's own `Invoice`/`InvoiceItem` rows
 * and (read-only, via `SalesModule`'s existing export) `SalesFulfilmentItem.
 * costAmount` — the exact figure each fulfilment's own `DR COGS` journal was valued
 * at, never a second, independently-recomputed cost.
 */
@Injectable()
export class RevenueCogsService {
  constructor(
    private readonly financialStatementService: FinancialStatementService,
    private readonly invoiceRepository: InvoiceRepository,
    private readonly salesFulfilmentRepository: SalesFulfilmentRepository,
  ) {}

  async getRevenueReport(
    organisationId: string,
    params: { from?: Date; to: Date },
  ): Promise<RevenueReport> {
    const [pnl, byProduct, byCustomer] = await Promise.all([
      this.financialStatementService.getProfitAndLoss(organisationId, params),
      this.invoiceRepository.getRevenueByProduct(organisationId, params),
      this.invoiceRepository.getRevenueByCustomer(organisationId, params),
    ]);
    return {
      from: params.from ?? null,
      to: params.to,
      totalRevenue: pnl.revenue,
      byProduct,
      byCustomer,
    };
  }

  async getCogsReport(
    organisationId: string,
    params: { from?: Date; to: Date },
  ): Promise<CogsReport> {
    const [pnl, byProduct] = await Promise.all([
      this.financialStatementService.getProfitAndLoss(organisationId, params),
      this.salesFulfilmentRepository.getCogsBreakdownByProduct(organisationId, params),
    ]);
    return { from: params.from ?? null, to: params.to, totalCogs: pnl.costOfSales, byProduct };
  }
}
