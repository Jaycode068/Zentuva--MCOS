import { Injectable } from '@nestjs/common';
import { ProductType } from '@prisma/client';

import {
  InventoryValuationLine,
  InventoryValuationService,
  InventoryValuationTotals,
} from '../../finance/reports/inventory-valuation.service';
import { ReportTableResult } from '../reporting.types';

export interface InventoryPositionReport {
  totals: InventoryValuationTotals;
  table: ReportTableResult<InventoryValuationLine>;
}

/**
 * Sprint 45 — Reporting & Business Intelligence Foundation. Wraps the existing,
 * already-authoritative `InventoryValuationService.getValuation` — reused verbatim,
 * never recomputed (brief §4) — and adds only pagination over its `lines[]`, since
 * the underlying service itself returns every line unpaginated (fine for its
 * existing Finance page, but a reporting table with a real product catalogue could
 * grow large — brief §12 "use pagination for large detail datasets").
 */
@Injectable()
export class InventoryPositionReportService {
  constructor(private readonly inventoryValuationService: InventoryValuationService) {}

  async getReport(
    organisationId: string,
    params: { locationId?: string; productType?: ProductType; page: number; pageSize: number },
  ): Promise<InventoryPositionReport> {
    const valuation = await this.inventoryValuationService.getValuation(organisationId, {
      locationId: params.locationId,
      productType: params.productType,
    });
    const start = (params.page - 1) * params.pageSize;
    const pageLines = valuation.lines.slice(start, start + params.pageSize);
    return {
      totals: valuation.totals,
      table: {
        rows: pageLines,
        total: valuation.lines.length,
        page: params.page,
        pageSize: params.pageSize,
      },
    };
  }
}
