import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { ProductType, SalesOrderStatus } from '@prisma/client';
import { reportingPeriodQuerySchema, reportPaginationSchema } from '@zentuva/validation';

import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { RequirePermission } from '../identity/auth/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../identity/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../identity/auth/guards/permissions.guard';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { toCsv } from './reporting-csv.util';
import { ReportingService } from './reporting.service';

/**
 * Sprint 45 — Reporting & Business Intelligence Foundation (docs/domains/reporting.md
 * "API"). `@RequirePermission('reporting.catalogue.view')` at the controller level gates every
 * route's base visibility; each method additionally calls into `ReportingService`,
 * which re-checks that SPECIFIC report's own existing domain permission before
 * returning any data (brief §10) — `reporting.catalogue.view` alone never unlocks a report's
 * actual figures.
 *
 * Every query parameter is parsed through a Zod schema before use (brief §13) — no
 * raw string ever reaches a Prisma `where` clause unvalidated, and no client-supplied
 * sort/filter field is ever used that isn't in a report's own `sortableFields`/
 * `supportedFilters` list (enforced inside each report service).
 */
@Controller('reporting')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission('reporting.catalogue.view')
export class ReportingController {
  constructor(private readonly reportingService: ReportingService) {}

  @Get('catalogue')
  getCatalogue(@CurrentUser() user: TokenPayload) {
    return this.reportingService.getCatalogue(user.organisationId, user.sub);
  }

  @Get('reports/sales-performance')
  getSalesPerformance(
    @CurrentUser() user: TokenPayload,
    @Query() periodQuery: Record<string, string>,
    @Query('customerId') customerId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const period = reportingPeriodQuerySchema.parse(periodQuery);
    const pagination = reportPaginationSchema.parse({ page, pageSize });
    return this.reportingService.getSalesPerformance(
      user.organisationId,
      user.sub,
      {
        preset: period.preset,
        customFrom: period.customFrom,
        customTo: period.customTo,
        comparison: period.comparison,
      },
      {
        customerId,
        status: status as SalesOrderStatus | undefined,
        ...pagination,
      },
    );
  }

  @Get('reports/sales-performance/export')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="sales-performance.csv"')
  async exportSalesPerformance(
    @CurrentUser() user: TokenPayload,
    @Query() periodQuery: Record<string, string>,
  ) {
    const period = reportingPeriodQuerySchema.parse(periodQuery);
    const report = await this.reportingService.getSalesPerformance(
      user.organisationId,
      user.sub,
      {
        preset: period.preset,
        customFrom: period.customFrom,
        customTo: period.customTo,
        comparison: period.comparison,
      },
      { page: 1, pageSize: 1000 },
    );
    return toCsv(
      [
        { key: 'orderCode', label: 'Order' },
        { key: 'customerName', label: 'Customer' },
        { key: 'status', label: 'Status' },
        { key: 'orderDate', label: 'Order Date', value: (row) => row.orderDate.toISOString() },
        { key: 'total', label: 'Total' },
      ],
      report.table.rows,
    );
  }

  @Get('reports/inventory-position')
  getInventoryPosition(
    @CurrentUser() user: TokenPayload,
    @Query('locationId') locationId?: string,
    @Query('productType') productType?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const pagination = reportPaginationSchema.parse({ page, pageSize });
    return this.reportingService.getInventoryPosition(user.organisationId, user.sub, {
      locationId,
      productType: productType as ProductType | undefined,
      ...pagination,
    });
  }

  @Get('reports/inventory-position/export')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="inventory-position.csv"')
  async exportInventoryPosition(
    @CurrentUser() user: TokenPayload,
    @Query('locationId') locationId?: string,
    @Query('productType') productType?: string,
  ) {
    const report = await this.reportingService.getInventoryPosition(user.organisationId, user.sub, {
      locationId,
      productType: productType as ProductType | undefined,
      page: 1,
      pageSize: 5000,
    });
    return toCsv(
      [
        { key: 'productCode', label: 'Product Code' },
        { key: 'productName', label: 'Product' },
        { key: 'locationName', label: 'Location' },
        { key: 'quantityOnHand', label: 'Quantity on Hand' },
        { key: 'averageUnitCost', label: 'Avg Unit Cost' },
        { key: 'inventoryValue', label: 'Inventory Value' },
      ],
      report.table.rows,
    );
  }

  @Get('reports/receivables')
  getReceivables(@CurrentUser() user: TokenPayload) {
    return this.reportingService.getReceivables(user.organisationId, user.sub);
  }

  @Get('reports/receivables/export')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="receivables.csv"')
  async exportReceivables(@CurrentUser() user: TokenPayload) {
    const report = await this.reportingService.getReceivables(user.organisationId, user.sub);
    return toCsv(
      [
        { key: 'customerCode', label: 'Customer Code' },
        { key: 'customerName', label: 'Customer' },
        { key: 'current', label: 'Current' },
        { key: 'days1To30', label: '1-30 Days' },
        { key: 'days31To60', label: '31-60 Days' },
        { key: 'days61To90', label: '61-90 Days' },
        { key: 'days90Plus', label: '90+ Days' },
        { key: 'totalOutstanding', label: 'Total Outstanding' },
      ],
      report.byCustomer,
    );
  }

  @Get('reports/payables')
  getPayables(@CurrentUser() user: TokenPayload) {
    return this.reportingService.getPayables(user.organisationId, user.sub);
  }

  @Get('reports/payables/export')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="payables.csv"')
  async exportPayables(@CurrentUser() user: TokenPayload) {
    const report = await this.reportingService.getPayables(user.organisationId, user.sub);
    return toCsv(
      [
        { key: 'supplierCode', label: 'Supplier Code' },
        { key: 'supplierName', label: 'Supplier' },
        { key: 'current', label: 'Current' },
        { key: 'days1To30', label: '1-30 Days' },
        { key: 'days31To60', label: '31-60 Days' },
        { key: 'days61To90', label: '61-90 Days' },
        { key: 'days90Plus', label: '90+ Days' },
        { key: 'totalOutstanding', label: 'Total Outstanding' },
      ],
      report.bySupplier,
    );
  }

  @Get('reports/production-performance')
  getProductionPerformance(
    @CurrentUser() user: TokenPayload,
    @Query() periodQuery: Record<string, string>,
    @Query('productId') productId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const period = reportingPeriodQuerySchema.parse(periodQuery);
    const pagination = reportPaginationSchema.parse({ page, pageSize });
    return this.reportingService.getProductionPerformance(
      user.organisationId,
      user.sub,
      {
        preset: period.preset,
        customFrom: period.customFrom,
        customTo: period.customTo,
        comparison: period.comparison,
      },
      { productId, ...pagination },
    );
  }

  @Get('reports/production-performance/export')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="production-performance.csv"')
  async exportProductionPerformance(
    @CurrentUser() user: TokenPayload,
    @Query() periodQuery: Record<string, string>,
  ) {
    const period = reportingPeriodQuerySchema.parse(periodQuery);
    const report = await this.reportingService.getProductionPerformance(
      user.organisationId,
      user.sub,
      {
        preset: period.preset,
        customFrom: period.customFrom,
        customTo: period.customTo,
        comparison: period.comparison,
      },
      { page: 1, pageSize: 1000 },
    );
    return toCsv(
      [
        { key: 'productionOrderNumber', label: 'Order' },
        { key: 'productName', label: 'Product' },
        { key: 'plannedQuantity', label: 'Planned Qty' },
        { key: 'producedQuantity', label: 'Produced Qty' },
        { key: 'acceptedQuantity', label: 'Accepted Qty' },
        { key: 'rejectedQuantity', label: 'Rejected Qty' },
        { key: 'yieldPercent', label: 'Yield %', value: (row) => row.yieldPercent ?? '' },
        { key: 'materialCost', label: 'Material Cost' },
      ],
      report.table.rows,
    );
  }

  @Get('reports/workforce-summary')
  getWorkforceSummary(
    @CurrentUser() user: TokenPayload,
    @Query() periodQuery: Record<string, string>,
  ) {
    const period = reportingPeriodQuerySchema.parse(periodQuery);
    return this.reportingService.getWorkforceSummary(user.organisationId, user.sub, {
      preset: period.preset,
      customFrom: period.customFrom,
      customTo: period.customTo,
      comparison: period.comparison,
    });
  }

  @Get('reports/operational-exceptions')
  getOperationalExceptions(@CurrentUser() user: TokenPayload) {
    return this.reportingService.getOperationalExceptions(user.organisationId, user.sub);
  }
}
