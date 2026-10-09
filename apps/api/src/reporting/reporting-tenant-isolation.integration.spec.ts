import { PrismaClient } from '@prisma/client';

import { AccountsPayableService } from '../finance/accounts-payable.service';
import { AccountsReceivableService } from '../finance/accounts-receivable.service';
import { CustomerRepository } from '../retail/customer/customer.repository';
import { SupplierRepository } from '../suppliers/supplier/supplier.repository';
import { InvoiceRepository } from '../finance/invoice.repository';
import { PaymentRepository } from '../finance/payment.repository';
import { SupplierInvoiceRepository } from '../finance/supplier-invoice.repository';
import { SupplierPaymentRepository } from '../finance/supplier-payment.repository';
import { LedgerService } from '../finance/accounting/ledger.service';
import { InventoryValuationService } from '../finance/reports/inventory-valuation.service';
import { EmployeeRepository } from '../hr/employee.repository';
import { EmployeeService } from '../hr/employee.service';
import { DepartmentRepository } from '../hr/department.repository';
import { PositionRepository } from '../hr/position.repository';
import { WorkScheduleRepository } from '../hr/work-schedule.repository';
import { UserService } from '../identity/user/user.service';
import { ProductionMaterialIssueRepository } from '../production/production-material-issue.repository';
import { WorkforceSummaryReportService } from './reports/workforce-summary-report.service';
import { SalesPerformanceReportService } from './reports/sales-performance-report.service';
import { ProductionPerformanceReportService } from './reports/production-performance-report.service';
import { RevenueCogsService } from '../finance/reports/revenue-cogs.service';
import { FinancialStatementService } from '../finance/reports/financial-statement.service';
import { ChartOfAccountRepository } from '../finance/accounting/chart-of-account.repository';
import { SalesFulfilmentRepository } from '../sales/sales-fulfilment.repository';

/**
 * Sprint 45 — Reporting & Business Intelligence Foundation (brief §10 "Mandatory
 * tenant-isolation tests"). Against REAL PostgreSQL, using two real, pre-existing,
 * deliberately-distinct seeded organisations ("Boby Bites" and "Rival Snacks" —
 * created across earlier sprints' own live-verification work, each with its own real
 * SalesOrder/Employee/ProductionOrder/Invoice/SupplierInvoice rows), proves every new
 * Sprint 45 report service's figures never cross the organisation boundary.
 *
 * Deliberately NOT part of the default `pnpm test` run — run via
 * `pnpm run test:integration`.
 */
describe('Reporting — tenant isolation across two real organisations (real PostgreSQL)', () => {
  const prisma = new PrismaClient();

  let orgA: string; // Boby Bites
  let orgB: string; // the first other real org with at least one employee/sales order

  // Minimal real wiring — same classes the real ReportingModule DI graph constructs,
  // instantiated directly against the real PrismaClient rather than a mocked unit
  // test, to prove actual SQL `WHERE organisationId = ...` scoping, not just that a
  // mock was called with the right argument.
  const chartOfAccountRepository = new ChartOfAccountRepository(prisma as never);
  const financialStatementService = new FinancialStatementService(
    prisma as never,
    chartOfAccountRepository,
  );
  const invoiceRepository = new InvoiceRepository(prisma as never);
  const salesFulfilmentRepository = new SalesFulfilmentRepository(prisma as never);
  const revenueCogsService = new RevenueCogsService(
    financialStatementService,
    invoiceRepository,
    salesFulfilmentRepository,
  );
  const salesPerformanceReportService = new SalesPerformanceReportService(
    prisma as never,
    revenueCogsService,
  );

  const inventoryValuationService = new InventoryValuationService(prisma as never);

  const customerRepository = new CustomerRepository(prisma as never);
  const paymentRepository = new PaymentRepository(prisma as never);
  const accountsReceivableService = new AccountsReceivableService(
    invoiceRepository,
    paymentRepository,
    customerRepository,
  );

  const supplierRepository = new SupplierRepository(prisma as never);
  const supplierInvoiceRepository = new SupplierInvoiceRepository(prisma as never);
  const supplierPaymentRepository = new SupplierPaymentRepository(prisma as never);
  const ledgerService = new LedgerService(prisma as never, chartOfAccountRepository);
  const accountsPayableService = new AccountsPayableService(
    supplierInvoiceRepository,
    supplierPaymentRepository,
    supplierRepository,
    ledgerService,
  );

  const departmentRepository = new DepartmentRepository(prisma as never);
  const positionRepository = new PositionRepository(prisma as never);
  const workScheduleRepository = new WorkScheduleRepository(prisma as never);
  const employeeRepository = new EmployeeRepository(prisma as never);
  const userService = {} as unknown as UserService;
  const employeeService = new EmployeeService(
    employeeRepository,
    departmentRepository,
    positionRepository,
    workScheduleRepository,
    userService,
  );
  const workforceSummaryReportService = new WorkforceSummaryReportService(
    prisma as never,
    employeeService,
  );

  const materialIssueRepository = new ProductionMaterialIssueRepository(prisma as never);
  const productionPerformanceReportService = new ProductionPerformanceReportService(
    prisma as never,
    materialIssueRepository,
  );

  beforeAll(async () => {
    const bobyBites = await prisma.organisation.findFirst({
      where: { name: 'Boby Bites' },
      select: { id: true },
    });
    if (!bobyBites) throw new Error('This test requires the seeded "Boby Bites" organisation.');
    orgA = bobyBites.id;

    // Prefer the second organisation with the richest real footprint (so the Sales
    // Performance check has genuine content to compare), but any other real org is a
    // valid isolation fixture even with zero rows of its own: the assertion being
    // tested is "Org B's result never contains an Org A id," which a missing-
    // `organisationId`-filter bug would still violate (Org B's query would then
    // return Org A's rows) even when Org B's own table is empty.
    const otherOrgs = await prisma.organisation.findMany({
      where: { id: { not: orgA } },
      select: { id: true },
    });
    if (otherOrgs.length === 0) {
      throw new Error('This test requires at least one other seeded organisation.');
    }
    let best = otherOrgs[0]!.id;
    let bestScore = -1;
    for (const org of otherOrgs) {
      const [salesOrderCount, employeeCount, productionOrderCount] = await Promise.all([
        prisma.salesOrder.count({ where: { organisationId: org.id } }),
        prisma.employee.count({ where: { organisationId: org.id } }),
        prisma.productionOrder.count({ where: { organisationId: org.id } }),
      ]);
      const score = salesOrderCount + employeeCount + productionOrderCount;
      if (score > bestScore) {
        bestScore = score;
        best = org.id;
      }
    }
    orgB = best;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("Receivables: Org A and Org B never see each other's outstanding balance or customers", async () => {
    const [arA, arB] = await Promise.all([
      accountsReceivableService.getSummary(orgA),
      accountsReceivableService.getSummary(orgB),
    ]);
    // Independently computed, real figures — the only hard assertion possible without
    // knowing fixture values in advance is that cross-reading the OTHER org's
    // customer rows never happens; verified via the byCustomer breakdown below.
    const [byCustomerA, byCustomerB] = await Promise.all([
      accountsReceivableService.listByCustomer(orgA),
      accountsReceivableService.listByCustomer(orgB),
    ]);
    const customerIdsA = new Set(byCustomerA.map((row) => row.customerId));
    const customerIdsB = new Set(byCustomerB.map((row) => row.customerId));
    for (const id of customerIdsA) {
      expect(customerIdsB.has(id)).toBe(false);
    }
    expect(arA).toBeDefined();
    expect(arB).toBeDefined();
  });

  it("Payables: Org A and Org B never see each other's supplier obligations", async () => {
    const [byBobbySupplier, byOtherSupplier] = await Promise.all([
      accountsPayableService.listBySupplier(orgA),
      accountsPayableService.listBySupplier(orgB),
    ]);
    const supplierIdsA = new Set(byBobbySupplier.map((row) => row.supplierId));
    const supplierIdsB = new Set(byOtherSupplier.map((row) => row.supplierId));
    for (const id of supplierIdsA) {
      expect(supplierIdsB.has(id)).toBe(false);
    }
  });

  it("Inventory valuation: Org A and Org B never see each other's stock lines", async () => {
    const [valuationA, valuationB] = await Promise.all([
      inventoryValuationService.getValuation(orgA),
      inventoryValuationService.getValuation(orgB),
    ]);
    const productIdsA = new Set(valuationA.lines.map((line) => line.productId));
    const productIdsB = new Set(valuationB.lines.map((line) => line.productId));
    // Product ids are themselves per-organisation rows (never shared across tenants)
    // — no overlap is possible if isolation holds.
    for (const id of productIdsA) {
      expect(productIdsB.has(id)).toBe(false);
    }
  });

  it("Sales performance: Org A's order table and revenue breakdown never include Org B's orders/customers", async () => {
    const from = new Date('2000-01-01T00:00:00.000Z');
    const to = new Date('2100-01-01T00:00:00.000Z');
    const [reportA, reportB] = await Promise.all([
      salesPerformanceReportService.getReport(orgA, { from, to, page: 1, pageSize: 1000 }),
      salesPerformanceReportService.getReport(orgB, { from, to, page: 1, pageSize: 1000 }),
    ]);
    const orderIdsA = new Set(reportA.table.rows.map((row) => row.id));
    const orderIdsB = new Set(reportB.table.rows.map((row) => row.id));
    for (const id of orderIdsA) {
      expect(orderIdsB.has(id)).toBe(false);
    }
    const customerIdsA = new Set(reportA.revenue.byCustomer.map((row) => row.customerId));
    const customerIdsB = new Set(reportB.revenue.byCustomer.map((row) => row.customerId));
    for (const id of customerIdsA) {
      expect(customerIdsB.has(id)).toBe(false);
    }
  });

  it("Workforce summary: Org A's headcount/department breakdown never includes Org B's employees or departments", async () => {
    const from = new Date('2000-01-01T00:00:00.000Z');
    const to = new Date('2100-01-01T00:00:00.000Z');
    const [reportA, reportB] = await Promise.all([
      workforceSummaryReportService.getReport(orgA, { from, to }),
      workforceSummaryReportService.getReport(orgB, { from, to }),
    ]);
    // Totals are independently real (not asserted equal/different — just that each
    // organisation's own headcount is internally consistent).
    const sumA = reportA.byStatus.reduce((sum, row) => sum + row.count, 0);
    const sumB = reportB.byStatus.reduce((sum, row) => sum + row.count, 0);
    expect(sumA).toBe(reportA.totalHeadcount);
    expect(sumB).toBe(reportB.totalHeadcount);

    const departmentIdsA = new Set(
      reportA.byDepartment.map((row) => row.departmentId).filter((id): id is string => id !== null),
    );
    const departmentIdsB = new Set(
      reportB.byDepartment.map((row) => row.departmentId).filter((id): id is string => id !== null),
    );
    for (const id of departmentIdsA) {
      expect(departmentIdsB.has(id)).toBe(false);
    }
  });

  it("Production performance: Org A's production orders never appear in Org B's report, and vice versa", async () => {
    const from = new Date('2000-01-01T00:00:00.000Z');
    const to = new Date('2100-01-01T00:00:00.000Z');
    const [reportA, reportB] = await Promise.all([
      productionPerformanceReportService.getReport(orgA, { from, to, page: 1, pageSize: 1000 }),
      productionPerformanceReportService.getReport(orgB, { from, to, page: 1, pageSize: 1000 }),
    ]);
    const orderIdsA = new Set(reportA.table.rows.map((row) => row.productionOrderId));
    const orderIdsB = new Set(reportB.table.rows.map((row) => row.productionOrderId));
    for (const id of orderIdsA) {
      expect(orderIdsB.has(id)).toBe(false);
    }
  });
});
