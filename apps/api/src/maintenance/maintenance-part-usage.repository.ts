import { Injectable } from '@nestjs/common';
import {
  InventoryTransactionType,
  MaintenancePartUsage,
  MaintenancePartUsageType,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export interface RecordPartUsageData {
  organisationId: string;
  workOrderId: string;
  productId: string;
  quantity: number;
  unitOfMeasure?: string;
  usageType: MaintenancePartUsageType;
  notes?: string;
  idempotencyKey?: string;
  recordedById: string;
}

export interface RecordPartUsageResult {
  partUsage: MaintenancePartUsage;
  wasCreated: boolean;
}

export interface IssuePartUsageData {
  organisationId: string;
  partUsageId: string;
  locationId: string;
  issueIdempotencyKey?: string;
  issuedById: string;
}

export interface IssuePartUsageResult {
  partUsage: MaintenancePartUsage;
  wasIssued: boolean;
}

export interface CancelPartUsageData {
  organisationId: string;
  partUsageId: string;
  cancelledById: string;
}

/** Thrown when the part usage row can't be found for this tenant. */
export class PartUsageNotFoundError extends Error {}

/** Thrown when `issue()`/`cancel()` is attempted against a row that isn't
 *  `REQUESTED` (and no matching `issueIdempotencyKey` replay applies) —
 *  the same "re-check status inside the transaction, not just at the
 *  service pre-check" discipline `WorkOrderRepository.complete()` already
 *  establishes for `WorkOrderStatus`. */
export class PartUsageStatusConflictError extends Error {}

/** Thrown when the requested quantity exceeds `InventoryStock.quantityOnHand`
 *  at the given location — the same `InsufficientStockError` shape
 *  `SalesFulfilmentRepository`/`ProductionMaterialIssueRepository` already
 *  establish (its own `Error` subclass, not `BadRequestException`, since
 *  this file has no Nest HTTP context). */
export class InsufficientStockError extends Error {}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundQuantity(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Thin Prisma access for `MaintenancePartUsage` (Sprint 21, docs/domains/
 * maintenance.md "Parts / Material Usage Boundary"; extended Sprint 22,
 * docs/domains/maintenance-integration.md "Inventory Integration").
 *
 * `record()` (Sprint 21, unchanged in shape) creates a `REQUESTED` row —
 * no inventory effect. `issue()` (Sprint 22) is the one and only place a
 * maintenance part usage ever touches `InventoryStock`/`InventoryTransaction`
 * — inside its own `$transaction`, writing those two tables directly via
 * the injected `PrismaService`, the same deliberate, narrow, documented
 * exception to ADR-002's domain-ownership convention that
 * `SalesFulfilmentRepository.create()`/`ProductionMaterialIssueRepository.
 * issue()` already establish, made for atomicity. No shared "issue stock"
 * service is invoked and none is invented — see
 * docs/domains/maintenance-integration.md "Inventory Integration" for why
 * no such reusable primitive exists yet in Inventory itself.
 *
 * `cancel()` never touches inventory — a `REQUESTED` row that's no longer
 * needed is simply marked `CANCELLED`, nothing to reverse.
 */
@Injectable()
export class MaintenancePartUsageRepository {
  constructor(private readonly prisma: PrismaService) {}

  findManyByWorkOrder(
    organisationId: string,
    workOrderId: string,
  ): Promise<MaintenancePartUsage[]> {
    return this.prisma.maintenancePartUsage.findMany({
      where: { organisationId, workOrderId },
      orderBy: { createdAt: 'desc' },
    });
  }

  findById(organisationId: string, id: string): Promise<MaintenancePartUsage | null> {
    return this.prisma.maintenancePartUsage.findFirst({ where: { id, organisationId } });
  }

  async record(data: RecordPartUsageData): Promise<RecordPartUsageResult> {
    return this.prisma.$transaction(async (tx) => {
      if (data.idempotencyKey) {
        const existing = await tx.maintenancePartUsage.findUnique({
          where: {
            organisationId_idempotencyKey: {
              organisationId: data.organisationId,
              idempotencyKey: data.idempotencyKey,
            },
          },
        });
        if (existing) {
          return { partUsage: existing, wasCreated: false };
        }
      }

      const partUsage = await tx.maintenancePartUsage.create({
        data: {
          organisationId: data.organisationId,
          workOrderId: data.workOrderId,
          productId: data.productId,
          quantity: data.quantity,
          unitOfMeasure: data.unitOfMeasure,
          usageType: data.usageType,
          notes: data.notes,
          idempotencyKey: data.idempotencyKey,
          recordedById: data.recordedById,
        },
      });

      return { partUsage, wasCreated: true };
    });
  }

  /** The one atomic "issue a maintenance part from Inventory" operation
   *  (Sprint 22, docs/domains/maintenance-integration.md "Inventory
   *  Integration"). Idempotency-check-first on `issueIdempotencyKey`
   *  (before any status/stock precheck — the Sprint 9→10 lesson), then
   *  re-validates `status === 'REQUESTED'` *inside* the transaction
   *  (closing the race a stale service-level precheck couldn't), then
   *  reads/guards/decrements `InventoryStock` and inserts exactly one
   *  `InventoryTransaction` (type `ISSUE`) — all in the same transaction
   *  as the `MaintenancePartUsage` row's own update, so a stock guard
   *  failure rolls back everything, including the status flip. */
  async issue(data: IssuePartUsageData): Promise<IssuePartUsageResult> {
    return this.prisma.$transaction(async (tx) => {
      if (data.issueIdempotencyKey) {
        const existing = await tx.maintenancePartUsage.findUnique({
          where: {
            organisationId_issueIdempotencyKey: {
              organisationId: data.organisationId,
              issueIdempotencyKey: data.issueIdempotencyKey,
            },
          },
        });
        if (existing) {
          return { partUsage: existing, wasIssued: false };
        }
      }

      const partUsage = await tx.maintenancePartUsage.findFirst({
        where: { id: data.partUsageId, organisationId: data.organisationId },
      });
      if (!partUsage) {
        throw new PartUsageNotFoundError('Maintenance part usage not found');
      }
      if (partUsage.status === 'ISSUED') {
        // Soft-idempotent only when no issueIdempotencyKey was supplied to
        // distinguish this from a genuine key-matched replay above — a
        // bare repeat issue() call against an already-issued row with no
        // key is treated as a no-op return, never a duplicate stock move.
        return { partUsage, wasIssued: false };
      }
      if (partUsage.status !== 'REQUESTED') {
        throw new PartUsageStatusConflictError(
          `Cannot issue a part usage in status ${partUsage.status}`,
        );
      }

      const existingStock = await tx.inventoryStock.findUnique({
        where: {
          organisationId_productId_locationId: {
            organisationId: data.organisationId,
            productId: partUsage.productId,
            locationId: data.locationId,
          },
        },
      });
      const currentQuantity = existingStock?.quantityOnHand ?? 0;
      const newQuantity = roundQuantity(currentQuantity - partUsage.quantity);
      if (newQuantity < 0) {
        throw new InsufficientStockError(
          `Insufficient stock for product ${partUsage.productId} (available: ${currentQuantity}, requested: ${partUsage.quantity})`,
        );
      }
      const unitCost = existingStock?.averageUnitCost ?? 0;
      const totalCost = roundCurrency(partUsage.quantity * unitCost);

      await tx.inventoryStock.upsert({
        where: {
          organisationId_productId_locationId: {
            organisationId: data.organisationId,
            productId: partUsage.productId,
            locationId: data.locationId,
          },
        },
        create: {
          organisationId: data.organisationId,
          productId: partUsage.productId,
          locationId: data.locationId,
          quantityOnHand: newQuantity,
        },
        update: { quantityOnHand: newQuantity },
      });

      const inventoryTransaction = await tx.inventoryTransaction.create({
        data: {
          organisationId: data.organisationId,
          productId: partUsage.productId,
          locationId: data.locationId,
          transactionType: InventoryTransactionType.ISSUE,
          quantity: partUsage.quantity,
          referenceType: 'MaintenancePartUsage',
          referenceId: partUsage.id,
        },
      });

      const updated = await tx.maintenancePartUsage.update({
        where: { id: partUsage.id },
        data: {
          status: 'ISSUED',
          locationId: data.locationId,
          inventoryTransactionId: inventoryTransaction.id,
          unitCost,
          totalCost,
          issuedAt: new Date(),
          issuedById: data.issuedById,
          issueIdempotencyKey: data.issueIdempotencyKey,
        },
      });

      return { partUsage: updated, wasIssued: true };
    });
  }

  async cancel(data: CancelPartUsageData): Promise<{ partUsage: MaintenancePartUsage }> {
    return this.prisma.$transaction(async (tx) => {
      const partUsage = await tx.maintenancePartUsage.findFirst({
        where: { id: data.partUsageId, organisationId: data.organisationId },
      });
      if (!partUsage) {
        throw new PartUsageNotFoundError('Maintenance part usage not found');
      }
      if (partUsage.status === 'CANCELLED') {
        return { partUsage };
      }
      if (partUsage.status !== 'REQUESTED') {
        throw new PartUsageStatusConflictError(
          `Cannot cancel a part usage in status ${partUsage.status} — it has already been issued`,
        );
      }
      const updated = await tx.maintenancePartUsage.update({
        where: { id: partUsage.id },
        data: { status: 'CANCELLED' },
      });
      return { partUsage: updated };
    });
  }
}
