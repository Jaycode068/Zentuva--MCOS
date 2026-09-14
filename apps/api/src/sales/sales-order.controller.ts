import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SalesOrderStatus } from '@prisma/client';
import {
  CreateSalesFulfilmentInput,
  CreateSalesOrderInput,
  UpdateSalesOrderInput,
  createSalesFulfilmentSchema,
  createSalesOrderSchema,
  updateSalesOrderSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { EmployeeService } from '../hr/employee.service';
import { AuditService } from '../identity/audit/audit.service';
import { ZodValidationPipe } from '../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../identity/auth/guards/jwt-auth.guard';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { SALES_AUDIT_ACTIONS } from './sales-audit-actions';
import { JournalEntrySummary, SalesFulfilmentWithItems } from './sales-fulfilment.repository';
import { SalesFulfilmentService } from './sales-fulfilment.service';
import { SalesOrderWithRelations } from './sales-order.repository';
import { SalesOrderService } from './sales-order.service';
import { RequirePermission } from '../identity/auth/decorators/require-permission.decorator';
import { PermissionsGuard } from '../identity/auth/guards/permissions.guard';
import { EffectiveAccessResolver } from '../identity/authorization/effective-access-resolver';
import { ScopeEvaluator } from '../identity/authorization/scope-evaluator';

/**
 * Sales Order HTTP surface (Sprint 4.8, docs/domains/sales.md; migrated to the central
 * permission system in Sprint 25.1, docs/architecture/authorization-coverage.md).
 * Every route requires a `sales.order.*`/`sales.fulfilment.*` permission via
 * `PermissionsGuard`.
 *
 * Tenant isolation: every method resolves the target order by `(id, organisationId)`
 * together, same convention as every other domain controller.
 */
@Controller('sales/orders')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SalesOrderController {
  constructor(
    private readonly salesOrderService: SalesOrderService,
    private readonly salesFulfilmentService: SalesFulfilmentService,
    private readonly auditService: AuditService,
    private readonly effectiveAccessResolver: EffectiveAccessResolver,
    private readonly scopeEvaluator: ScopeEvaluator,
    private readonly employeeService: EmployeeService,
  ) {}

  /** Sprint 25.1 (docs/architecture/authorization-coverage.md) — `sales.order.view`'s
   *  real, server-enforced scope, broadest-satisfiable-scope-wins precedence (multiple
   *  roles union additively, so the caller gets whichever of their granted scopes sees
   *  the most): `ORGANISATION` sees every order; `OWN_TEAM` is forced to orders whose
   *  `salesAgentId` belongs to one of the caller's direct reports (via the existing
   *  `Employee.managerEmployeeId` relationship, then each report's linked `User.id` —
   *  the same "team" definition `EmployeeController`/`AttendanceController` already
   *  use); `OWN_RECORDS` is forced to orders where `salesAgentId` (always the
   *  authenticated caller who created the order, per its own schema comment) matches
   *  the caller. `ASSIGNED_TERRITORY` is recorded and previewable (access-control.md
   *  §6) but not enforced here — no server-side data links a `User` to a `Territory`,
   *  so pretending to filter by it would be exactly the "cannot be proven" overclaim
   *  the scope model forbids; a caller whose only granted scope is `ASSIGNED_TERRITORY`
   *  (or has no usable scope at all) gets an empty page rather than unrestricted
   *  access. */
  @Get()
  @RequirePermission('sales.order.view')
  async list(
    @CurrentUser() user: TokenPayload,
    @Query('status') status?: SalesOrderStatus,
    @Query('customerId') customerId?: string,
    @Query('outletId') outletId?: string,
    @Query('search') search?: string,
  ) {
    const access = await this.effectiveAccessResolver.resolve(user.organisationId, user.sub);
    const grantedScopes = this.scopeEvaluator.grantedScopes(access, 'sales.order.view');

    let salesAgentId: string | undefined;
    let salesAgentIds: string[] | undefined;
    if (!grantedScopes.includes('ORGANISATION')) {
      if (grantedScopes.includes('OWN_TEAM')) {
        const callerEmployee = await this.employeeService.getByUserId(
          user.organisationId,
          user.sub,
        );
        if (!callerEmployee) {
          return { items: [] };
        }
        const directReports = await this.employeeService.list(user.organisationId, {
          managerEmployeeId: callerEmployee.id,
          pageSize: 100,
        });
        salesAgentIds = directReports.items
          .map((employee) => employee.user?.id)
          .filter((id): id is string => !!id);
        if (salesAgentIds.length === 0) {
          return { items: [] };
        }
      } else if (grantedScopes.includes('OWN_RECORDS')) {
        salesAgentId = user.sub;
      } else {
        // No usable scope proven from server-side data — deny by default, never fall
        // back to unrestricted access (access-control.md §5).
        return { items: [] };
      }
    }

    const orders = await this.salesOrderService.list(user.organisationId, {
      status,
      customerId,
      outletId,
      salesAgentId,
      salesAgentIds,
      search: search?.trim() || undefined,
    });
    return { items: orders.map(toSalesOrderResponse) };
  }

  @Get(':id')
  @RequirePermission('sales.order.view')
  async getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const order = await this.salesOrderService.getById(user.organisationId, id);
    return toSalesOrderResponse(order);
  }

  @Post()
  @RequirePermission('sales.order.create')
  async create(
    @Body(new ZodValidationPipe(createSalesOrderSchema)) body: CreateSalesOrderInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const created = await this.salesOrderService.create(user.organisationId, body, user.sub);

    await this.auditService.record({
      action: SALES_AUDIT_ACTIONS.ORDER_CREATED,
      entityType: 'SalesOrder',
      entityId: created.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: {
        orderCode: created.orderCode,
        customerId: created.customerId,
        outletId: created.outletId,
        total: created.total,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toSalesOrderResponse(created);
  }

  @Patch(':id')
  @RequirePermission('sales.order.edit')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSalesOrderSchema)) body: UpdateSalesOrderInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.salesOrderService.update(user.organisationId, id, body, user.sub);

    await this.auditService.record({
      action: SALES_AUDIT_ACTIONS.ORDER_UPDATED,
      entityType: 'SalesOrder',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { fields: Object.keys(body) },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toSalesOrderResponse(updated);
  }

  @Post(':id/confirm')
  @RequirePermission('sales.order.confirm')
  async confirm(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const updated = await this.salesOrderService.confirm(user.organisationId, id, user.sub);

    await this.auditService.record({
      action: SALES_AUDIT_ACTIONS.ORDER_CONFIRMED,
      entityType: 'SalesOrder',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toSalesOrderResponse(updated);
  }

  @Post(':id/cancel')
  @RequirePermission('sales.order.cancel')
  async cancel(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const updated = await this.salesOrderService.cancel(user.organisationId, id, user.sub);

    await this.auditService.record({
      action: SALES_AUDIT_ACTIONS.ORDER_CANCELLED,
      entityType: 'SalesOrder',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toSalesOrderResponse(updated);
  }

  /** `GET /:id/availability` (Sprint 4.9) — read-only, auth-only (Member can see it).
   *  Never gates `fulfil()`; purely informational. */
  @Get(':id/availability')
  @RequirePermission('sales.order.view')
  async getAvailability(
    @CurrentUser() user: TokenPayload,
    @Param('id') id: string,
    @Query('locationId') locationId?: string,
  ) {
    const items = await this.salesFulfilmentService.getAvailability(
      user.organisationId,
      id,
      locationId,
    );
    return { items };
  }

  /** `GET /:id/fulfilments` (Sprint 4.9) — fulfilment history, auth-only. Each item's
   *  `journalEntry` (Sprint 10) is batch-fetched in one query rather than N. */
  @Get(':id/fulfilments')
  @RequirePermission('sales.order.view')
  async listFulfilments(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const items = await this.salesFulfilmentService.listFulfilments(user.organisationId, id);
    const journalEntries = await this.salesFulfilmentService.findJournalEntriesForFulfilments(
      user.organisationId,
      items.map((item) => item.id),
    );
    return {
      items: items.map((item) =>
        toSalesFulfilmentResponse(item, journalEntries.get(item.id) ?? null),
      ),
    };
  }

  /** `POST /:id/fulfil` (Sprint 4.9) — THE one write in this domain that actually moves
   *  inventory. Only emits an audit event when `wasCreated === true` — a replayed
   *  idempotent request (same `idempotencyKey`) must not double-record history. */
  @Post(':id/fulfil')
  @RequirePermission('sales.fulfilment.create')
  async fulfil(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createSalesFulfilmentSchema)) body: CreateSalesFulfilmentInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { fulfilment, order, journalEntry, wasCreated } =
      await this.salesFulfilmentService.fulfil(user.organisationId, id, body, user.sub);

    if (wasCreated) {
      await this.auditService.record({
        action: SALES_AUDIT_ACTIONS.ORDER_FULFILLED,
        entityType: 'SalesOrder',
        entityId: order.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: {
          fulfilmentId: fulfilment.id,
          newStatus: order.status,
          items: fulfilment.items.length,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      if (journalEntry) {
        await this.auditService.record({
          action: SALES_AUDIT_ACTIONS.FULFILMENT_COGS_POSTED,
          entityType: 'SalesFulfilment',
          entityId: fulfilment.id,
          organisationId: user.organisationId,
          actorUserId: user.sub,
          metadata: {
            journalEntryId: journalEntry.id,
            journalNumber: journalEntry.journalNumber,
            totalAmount: journalEntry.totalAmount,
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      }
    }

    return toSalesOrderResponse(order);
  }
}

function toSalesFulfilmentResponse(
  fulfilment: SalesFulfilmentWithItems,
  journalEntry: JournalEntrySummary | null = null,
) {
  return {
    id: fulfilment.id,
    fulfilmentDate: fulfilment.fulfilmentDate,
    location: fulfilment.location,
    notes: fulfilment.notes,
    journalEntry,
    items: fulfilment.items.map((item) => ({
      id: item.id,
      unitCost: item.unitCost,
      costAmount: item.costAmount,
      product: item.product,
      quantityFulfilled: item.quantityFulfilled,
    })),
    createdAt: fulfilment.createdAt,
  };
}

function toSalesOrderResponse(order: SalesOrderWithRelations) {
  return {
    id: order.id,
    orderCode: order.orderCode,
    customer: order.customer,
    outlet: order.outlet,
    salesAgentId: order.salesAgentId,
    status: order.status,
    orderDate: order.orderDate,
    notes: order.notes,
    subtotal: order.subtotal,
    discount: order.discount,
    total: order.total,
    items: order.items.map((item) => ({
      id: item.id,
      product: item.product,
      quantity: item.quantity,
      quantityFulfilled: item.quantityFulfilled,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
    })),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}
