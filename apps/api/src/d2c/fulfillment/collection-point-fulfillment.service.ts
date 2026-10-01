import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CollectionPointFulfillmentStatus } from '@prisma/client';

import { EffectiveAccessResolver } from '../../identity/authorization/effective-access-resolver';
import { AuditService } from '../../identity/audit/audit.service';
import { OutletRepository } from '../../retail/outlet/outlet.repository';
import { SalesFulfilmentService } from '../../sales/sales-fulfilment.service';
import { SalesOrderRepository } from '../../sales/sales-order.repository';
import { ConsumerService } from '../consumer/consumer.service';
import { COLLECTION_POINT_FULFILLMENT_AUDIT_ACTIONS } from './collection-point-fulfillment-audit-actions';
import {
  CollectionPointFulfillmentRepository,
  CollectionPointFulfillmentWithRelations,
} from './collection-point-fulfillment.repository';
import {
  AlreadyAssignedError,
  CollectionPointFulfillmentResult,
  CollectionPointNotEligibleError,
  InvalidFulfillmentTransitionError,
  NoEligibleCollectionPointError,
  NotAuthorizedForCollectionPointError,
} from './collection-point-fulfillment.types';

const SALES_CUSTOMER_MANAGE = 'sales.customer.manage';

/**
 * Sprint 37 — Collection Point Fulfillment (docs/domains/d2c.md "Order Assignment
 * Model" / "Fulfillment State Model"). Sits between a verified D2C payment
 * (`D2CPaymentService`, Sprint 35) and the EXISTING inventory-deducting fulfilment
 * mechanism (`SalesFulfilmentService.fulfil()`, Sprint 4.9) — never a parallel order or
 * inventory system. `SalesOrder` remains authoritative for whether the order itself is
 * done; this service only tracks the D2C-specific operational sub-workflow that happens
 * between `CONFIRMED` and `FULFILLED`.
 */
@Injectable()
export class CollectionPointFulfillmentService {
  private readonly logger = new Logger(CollectionPointFulfillmentService.name);

  constructor(
    private readonly repository: CollectionPointFulfillmentRepository,
    private readonly outletRepository: OutletRepository,
    private readonly salesOrderRepository: SalesOrderRepository,
    private readonly salesFulfilmentService: SalesFulfilmentService,
    private readonly consumerService: ConsumerService,
    private readonly auditService: AuditService,
    private readonly effectiveAccessResolver: EffectiveAccessResolver,
  ) {}

  /**
   * Best-effort, called from `D2CPaymentService.handleProviderCallback()` immediately
   * after a payment is verified and the order confirmed (brief "RECOMMENDED OPERATIONAL
   * FLOW", step 2-3). Deliberately swallows "no eligible Collection Point" as a logged,
   * audited no-op rather than throwing — the payment webhook it's called from must never
   * fail because of a downstream assignment problem (docs/domains/d2c.md "Payment
   * Boundary"). A manual assignment (`assignManually`) can be used later once a Collection
   * Point becomes available.
   */
  async autoAssign(organisationId: string, salesOrderId: string): Promise<void> {
    const existing = await this.repository.findBySalesOrderId(organisationId, salesOrderId);
    if (existing) {
      return; // Already assigned — a duplicate payment-success callback, safe no-op.
    }

    const order = await this.salesOrderRepository.findById(organisationId, salesOrderId);
    if (!order || !order.consumerId) {
      return; // Not a D2C order, or not found — nothing to assign.
    }
    const consumer = await this.consumerService.getById(organisationId, order.consumerId);
    if (!consumer?.territoryId) {
      this.logger.warn(
        `No eligible Collection Point for order ${salesOrderId}: consumer has no territory`,
      );
      await this.recordAssignmentFailure(organisationId, salesOrderId, 'consumer has no territory');
      return;
    }

    const outlet = await this.findEligibleOutlet(organisationId, consumer.territoryId);
    if (!outlet) {
      this.logger.warn(
        `No eligible Collection Point for order ${salesOrderId} in territory ${consumer.territoryId}`,
      );
      await this.recordAssignmentFailure(
        organisationId,
        salesOrderId,
        'no eligible Collection Point in territory',
      );
      return;
    }

    const created = await this.repository.create({
      organisation: { connect: { id: organisationId } },
      salesOrder: { connect: { id: salesOrderId } },
      outlet: { connect: { id: outlet.id } },
    });
    await this.auditService.record({
      action: COLLECTION_POINT_FULFILLMENT_AUDIT_ACTIONS.ASSIGNED,
      entityType: 'CollectionPointFulfillment',
      entityId: created.id,
      organisationId,
      metadata: { salesOrderId, outletId: outlet.id, mode: 'automatic' },
    });
  }

  /**
   * The manual/admin fallback path (brief §4) — used when auto-assignment found nothing
   * at payment time, or an admin wants a SPECIFIC outlet rather than the auto-selected
   * one. Unlike `autoAssign`, this throws on failure — a human is waiting for a response.
   */
  async assignManually(
    organisationId: string,
    salesOrderId: string,
    outletId: string | undefined,
    actorUserId: string,
  ): Promise<CollectionPointFulfillmentResult> {
    const existing = await this.repository.findBySalesOrderId(organisationId, salesOrderId);
    if (existing) {
      throw new AlreadyAssignedError('This order is already assigned to a Collection Point');
    }

    const order = await this.salesOrderRepository.findById(organisationId, salesOrderId);
    if (!order) {
      throw new NotFoundException('Sales order not found');
    }
    if (!order.consumerId) {
      throw new BadRequestException('Only D2C orders can be assigned to a Collection Point');
    }

    let outlet;
    if (outletId) {
      outlet = await this.outletRepository.findById(organisationId, outletId);
      if (!outlet || !this.isEligible(outlet)) {
        throw new CollectionPointNotEligibleError(
          'This outlet is not an eligible Collection Point',
        );
      }
    } else {
      const consumer = order.consumerId
        ? await this.consumerService.getById(organisationId, order.consumerId)
        : null;
      if (!consumer?.territoryId) {
        throw new NoEligibleCollectionPointError('Consumer has no territory to match against');
      }
      outlet = await this.findEligibleOutlet(organisationId, consumer.territoryId);
      if (!outlet) {
        throw new NoEligibleCollectionPointError(
          'No eligible Collection Point exists in the consumer territory',
        );
      }
    }

    const created = await this.repository.create({
      organisation: { connect: { id: organisationId } },
      salesOrder: { connect: { id: salesOrderId } },
      outlet: { connect: { id: outlet.id } },
    });
    await this.auditService.record({
      action: COLLECTION_POINT_FULFILLMENT_AUDIT_ACTIONS.ASSIGNED,
      entityType: 'CollectionPointFulfillment',
      entityId: created.id,
      organisationId,
      actorUserId,
      metadata: { salesOrderId, outletId: outlet.id, mode: 'manual' },
    });
    return this.toResult(created);
  }

  async startPreparing(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<CollectionPointFulfillmentResult> {
    const cpf = await this.getByIdOrThrow(organisationId, id);
    await this.assertAuthorized(organisationId, cpf, actorUserId);

    const updated = await this.repository.updateStatus(
      organisationId,
      id,
      [CollectionPointFulfillmentStatus.ASSIGNED],
      { status: CollectionPointFulfillmentStatus.PREPARING, preparingAt: new Date() },
    );
    if (!updated) {
      throw new InvalidFulfillmentTransitionError(
        'This order is not awaiting preparation — it may already be being prepared or further along',
      );
    }
    await this.auditService.record({
      action: COLLECTION_POINT_FULFILLMENT_AUDIT_ACTIONS.PREPARING_STARTED,
      entityType: 'CollectionPointFulfillment',
      entityId: id,
      organisationId,
      actorUserId,
    });
    return this.toResult(updated);
  }

  /**
   * PREPARING -> READY_FOR_COLLECTION. Runs the SAME non-authoritative stock pre-check
   * `SalesFulfilmentService.fulfil()` itself runs (brief step 5 "Inventory validation") —
   * reused directly via `getAvailability()`, never a second stock-checking mechanism. This
   * is a UX-only fast-fail; the authoritative check happens again, transactionally, inside
   * `fulfil()` at `confirmCollection` time.
   */
  async markReadyForCollection(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<CollectionPointFulfillmentResult> {
    const cpf = await this.getByIdOrThrow(organisationId, id);
    await this.assertAuthorized(organisationId, cpf, actorUserId);

    const outlet = await this.outletRepository.findById(organisationId, cpf.outletId);
    if (!outlet?.inventoryLocationId) {
      throw new BadRequestException('This Collection Point has no inventory location configured');
    }
    const availability = await this.salesFulfilmentService.getAvailability(
      organisationId,
      cpf.salesOrderId,
      outlet.inventoryLocationId,
    );
    const shortfalls = availability.filter((row) => row.shortfall > 0);
    if (shortfalls.length > 0) {
      throw new BadRequestException(
        `Insufficient stock at this Collection Point for: ${shortfalls
          .map((row) => row.product.name)
          .join(', ')}`,
      );
    }

    const updated = await this.repository.updateStatus(
      organisationId,
      id,
      [CollectionPointFulfillmentStatus.PREPARING],
      { status: CollectionPointFulfillmentStatus.READY_FOR_COLLECTION, readyAt: new Date() },
    );
    if (!updated) {
      throw new InvalidFulfillmentTransitionError(
        'This order is not being prepared — it may not have started preparation yet, or is already ready',
      );
    }
    await this.auditService.record({
      action: COLLECTION_POINT_FULFILLMENT_AUDIT_ACTIONS.READY_FOR_COLLECTION,
      entityType: 'CollectionPointFulfillment',
      entityId: id,
      organisationId,
      actorUserId,
    });
    return this.toResult(updated);
  }

  /**
   * READY_FOR_COLLECTION -> COLLECTED, THE moment inventory is actually deducted (brief
   * "COLLECTION CONFIRMATION" — an authorized Collection Point action is the proof, never
   * a consumer-facing OTP/QR). The status flip is a conditional `updateMany` FIRST — if it
   * matches zero rows (already collected, or a genuinely concurrent duplicate request),
   * this returns the EXISTING record without ever calling `fulfil()` again, so a retried
   * or duplicate confirmation can never double-deduct stock. Only the request that
   * genuinely wins the status flip proceeds to call the EXISTING, unmodified
   * `SalesFulfilmentService.fulfil()` — THE only inventory-deducting write path in this
   * codebase, reused here rather than duplicated — with a deterministic `idempotencyKey`
   * (this row's own id) as a second, independent safety net against a retried `fulfil()`
   * call specifically (e.g. the app crashing between the status flip committing and
   * `fulfil()` being called).
   */
  async confirmCollection(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<CollectionPointFulfillmentResult> {
    const cpf = await this.getByIdOrThrow(organisationId, id);
    await this.assertAuthorized(organisationId, cpf, actorUserId);

    const updated = await this.repository.updateStatus(
      organisationId,
      id,
      [CollectionPointFulfillmentStatus.READY_FOR_COLLECTION],
      {
        status: CollectionPointFulfillmentStatus.COLLECTED,
        collectedAt: new Date(),
        collectedById: actorUserId,
      },
    );
    if (!updated) {
      // Zero rows matched — either already COLLECTED (a genuinely concurrent duplicate
      // confirmation that lost the race, idempotent: report current state, never
      // re-deduct) or not yet READY_FOR_COLLECTION (a real out-of-order attempt). The
      // INITIAL `cpf` fetched above is stale by now — re-read the row's actual current
      // status rather than trusting a snapshot taken before the race resolved.
      const current = await this.getByIdOrThrow(organisationId, id);
      if (current.status === CollectionPointFulfillmentStatus.COLLECTED) {
        return this.toResult(current);
      }
      throw new InvalidFulfillmentTransitionError('This order is not ready for collection yet');
    }

    try {
      const outlet = await this.outletRepository.findById(organisationId, cpf.outletId);
      if (!outlet?.inventoryLocationId) {
        // Should be unreachable — markReadyForCollection already required this — but
        // fail loudly rather than silently skip the inventory deduction it guards.
        throw new BadRequestException('This Collection Point has no inventory location configured');
      }
      const order = await this.salesOrderRepository.findById(organisationId, cpf.salesOrderId);
      if (!order) {
        throw new NotFoundException('Sales order not found');
      }
      const items = order.items
        .filter((item) => item.quantity > item.quantityFulfilled)
        .map((item) => ({
          salesOrderItemId: item.id,
          quantity: item.quantity - item.quantityFulfilled,
        }));

      if (items.length > 0) {
        await this.salesFulfilmentService.fulfil(
          organisationId,
          cpf.salesOrderId,
          {
            locationId: outlet.inventoryLocationId,
            fulfilmentDate: new Date(),
            notes: 'D2C Collection Point fulfillment',
            idempotencyKey: `collection-point-fulfillment:${cpf.id}`,
            items,
          },
          actorUserId,
        );
      }
    } catch (error) {
      // Undo the optimistic COLLECTED flip above — never strand this fulfillment at a
      // terminal status when the actual inventory deduction failed. Found via live
      // verification: without this rollback, a `fulfil()` failure (e.g. no open
      // accounting period covering today, or a genuine stock shortfall) left the record
      // permanently COLLECTED while the underlying SalesOrder was never fulfilled and
      // stock was never deducted — because the very next retry's idempotency
      // short-circuit above then silently treated it as already-done, with no way back.
      // Reverting to READY_FOR_COLLECTION keeps the operation genuinely retryable.
      await this.repository.updateStatus(
        organisationId,
        id,
        [CollectionPointFulfillmentStatus.COLLECTED],
        {
          status: CollectionPointFulfillmentStatus.READY_FOR_COLLECTION,
          collectedAt: null,
          collectedById: null,
        },
      );
      throw error;
    }

    await this.auditService.record({
      action: COLLECTION_POINT_FULFILLMENT_AUDIT_ACTIONS.COLLECTED,
      entityType: 'CollectionPointFulfillment',
      entityId: id,
      organisationId,
      actorUserId,
      metadata: { salesOrderId: cpf.salesOrderId },
    });
    return this.toResult(updated);
  }

  async getById(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<CollectionPointFulfillmentResult> {
    const cpf = await this.getByIdOrThrow(organisationId, id);
    await this.assertAuthorized(organisationId, cpf, actorUserId);
    return this.toResult(cpf);
  }

  /** `GET /outlets/:outletId/queue` — the Field operational screen's own data source
   *  (brief "COLLECTION POINT / FIELD UX"). Ownership-enforced: a non-admin caller may
   *  only ever see the queue for an outlet they are the assigned representative of. */
  async getQueueForOutlet(
    organisationId: string,
    outletId: string,
    actorUserId: string,
  ): Promise<CollectionPointFulfillmentResult[]> {
    const outlet = await this.outletRepository.findById(organisationId, outletId);
    if (!outlet) {
      throw new NotFoundException('Outlet not found');
    }
    await this.assertActorAuthorizedForOutlet(organisationId, outlet, actorUserId);
    const rows = await this.repository.findManyByOutlet(organisationId, outletId);
    return rows.map((row) => this.toResult(row));
  }

  /**
   * The Field screen's own entry point (brief "COLLECTION POINT / FIELD UX") — a field
   * user has no reason to know their outlet's id up front. Returns every
   * Collection-Point-enabled outlet the caller may operate: outlets where
   * `collectionPointResponsibleUserId` is exactly this user, plus (for an admin holding
   * `sales.customer.manage`) every enabled Collection Point tenant-wide, matching the same
   * "assigned rep OR admin oversight" rule every other method here already enforces.
   */
  async getMyOutlets(
    organisationId: string,
    actorUserId: string,
  ): Promise<{ id: string; name: string }[]> {
    const enabled = await this.outletRepository.findManyByOrganisation(organisationId, {
      collectionPointStatus: 'ENABLED',
    });
    const access = await this.effectiveAccessResolver.resolve(organisationId, actorUserId);
    const isAdmin = access.isOwnerBypass || access.grants.has(SALES_CUSTOMER_MANAGE);
    const visible = isAdmin
      ? enabled
      : enabled.filter((outlet) => outlet.collectionPointResponsibleUserId === actorUserId);
    return visible.map((outlet) => ({ id: outlet.id, name: outlet.name }));
  }

  private async findEligibleOutlet(organisationId: string, territoryId: string) {
    const candidates = await this.outletRepository.findManyByOrganisation(organisationId, {
      territoryId,
      status: 'ACTIVE',
      collectionPointStatus: 'ENABLED',
    });
    const eligible = candidates
      .filter((outlet) => outlet.inventoryLocationId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return eligible[0] ?? null;
  }

  private isEligible(outlet: {
    status: string;
    collectionPointStatus: string;
    inventoryLocationId: string | null;
  }): boolean {
    return (
      outlet.status === 'ACTIVE' &&
      outlet.collectionPointStatus === 'ENABLED' &&
      !!outlet.inventoryLocationId
    );
  }

  private async recordAssignmentFailure(
    organisationId: string,
    salesOrderId: string,
    reason: string,
  ): Promise<void> {
    await this.auditService.record({
      action: COLLECTION_POINT_FULFILLMENT_AUDIT_ACTIONS.ASSIGNMENT_FAILED_NO_ELIGIBLE_OUTLET,
      entityType: 'SalesOrder',
      entityId: salesOrderId,
      organisationId,
      metadata: { reason },
    });
  }

  /** docs/domains/d2c.md "Authorization" — a resource-ownership check layered on top of
   *  the `d2c.collection_point.fulfil` permission gate (already enforced by the
   *  controller): the caller must either hold `sales.customer.manage` (admin oversight,
   *  the same permission that already governs Collection Point configuration, Sprint 36)
   *  or be the assigned `collectionPointResponsibleUserId` for THIS specific outlet. No
   *  existing `AccessScope` mechanism does this — `ASSIGNED_RECORDS`/`ASSIGNED_TERRITORY`
   *  remain "recorded, not enforced" everywhere else in this codebase (access-control.md
   *  §6); this is a new, narrow, genuinely-required check, not a re-implementation of one
   *  that already exists. */
  private async assertAuthorized(
    organisationId: string,
    cpf: CollectionPointFulfillmentWithRelations,
    actorUserId: string,
  ): Promise<void> {
    if (cpf.outlet.collectionPointResponsibleUserId === actorUserId) {
      return;
    }
    const access = await this.effectiveAccessResolver.resolve(organisationId, actorUserId);
    if (access.isOwnerBypass || access.grants.has(SALES_CUSTOMER_MANAGE)) {
      return;
    }
    throw new NotAuthorizedForCollectionPointError(
      'You are not authorized to operate this Collection Point',
    );
  }

  private async assertActorAuthorizedForOutlet(
    organisationId: string,
    outlet: { collectionPointResponsibleUserId: string | null },
    actorUserId: string,
  ): Promise<void> {
    if (outlet.collectionPointResponsibleUserId === actorUserId) {
      return;
    }
    const access = await this.effectiveAccessResolver.resolve(organisationId, actorUserId);
    if (access.isOwnerBypass || access.grants.has(SALES_CUSTOMER_MANAGE)) {
      return;
    }
    throw new ForbiddenException('You are not authorized to operate this Collection Point');
  }

  private async getByIdOrThrow(
    organisationId: string,
    id: string,
  ): Promise<CollectionPointFulfillmentWithRelations> {
    const cpf = await this.repository.findById(organisationId, id);
    if (!cpf) {
      throw new NotFoundException('Collection Point fulfillment not found');
    }
    return cpf;
  }

  private toResult(cpf: CollectionPointFulfillmentWithRelations): CollectionPointFulfillmentResult {
    return {
      id: cpf.id,
      orderReference: cpf.salesOrder.orderCode,
      orderDate: cpf.salesOrder.orderDate,
      total: cpf.salesOrder.total,
      outletId: cpf.outletId,
      outletName: cpf.outlet.name,
      status: cpf.status,
      assignedAt: cpf.assignedAt,
      preparingAt: cpf.preparingAt,
      readyAt: cpf.readyAt,
      collectedAt: cpf.collectedAt,
      salesOrderStatus: cpf.salesOrder.status,
      consumer: cpf.salesOrder.consumer
        ? {
            name: cpf.salesOrder.consumer.fullName,
            phoneNumber: cpf.salesOrder.consumer.phoneNumber,
          }
        : null,
      items: cpf.salesOrder.items.map((item) => ({
        productName: item.product.name,
        quantity: item.quantity,
        unit: item.product.unit,
      })),
    };
  }
}
