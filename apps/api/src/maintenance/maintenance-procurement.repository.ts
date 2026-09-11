import { Injectable } from '@nestjs/common';
import { MaintenanceProcurementRequirement } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export interface CreateProcurementRequirementData {
  organisationId: string;
  workOrderId: string;
  description: string;
  estimatedCost?: number;
  supplierId?: string;
  idempotencyKey?: string;
  createdById: string;
}

export interface CreateProcurementRequirementResult {
  requirement: MaintenanceProcurementRequirement;
  wasCreated: boolean;
}

export interface LinkProcurementRequirementData {
  organisationId: string;
  requirementId: string;
  purchaseOrderId: string;
}

/** Thrown when the requirement row can't be found for this tenant. */
export class ProcurementRequirementNotFoundError extends Error {}

/** Thrown when `link()`/`cancel()` is attempted against a row that isn't
 *  `IDENTIFIED` — the same status-recheck-inside-the-transaction
 *  discipline every other Sprint 21/22 mutation already follows. */
export class ProcurementRequirementStatusConflictError extends Error {}

/**
 * Thin Prisma access for `MaintenanceProcurementRequirement` (Sprint 22,
 * docs/domains/maintenance-integration.md "Procurement Integration") — the
 * smallest boundary Maintenance owns before Procurement's own, separate
 * workflow takes over. `purchaseOrderId` is a plain reference, assigned
 * only by `link()`; this file never writes `purchaseOrder` itself (the
 * real Purchase Order is always created by a human through Procurement's
 * own existing UI/service) — proven by `maintenance-independence.spec.ts`.
 */
@Injectable()
export class MaintenanceProcurementRepository {
  constructor(private readonly prisma: PrismaService) {}

  findManyByWorkOrder(
    organisationId: string,
    workOrderId: string,
  ): Promise<MaintenanceProcurementRequirement[]> {
    return this.prisma.maintenanceProcurementRequirement.findMany({
      where: { organisationId, workOrderId },
      orderBy: { createdAt: 'desc' },
    });
  }

  findById(organisationId: string, id: string): Promise<MaintenanceProcurementRequirement | null> {
    return this.prisma.maintenanceProcurementRequirement.findFirst({
      where: { id, organisationId },
    });
  }

  async create(
    data: CreateProcurementRequirementData,
  ): Promise<CreateProcurementRequirementResult> {
    return this.prisma.$transaction(async (tx) => {
      if (data.idempotencyKey) {
        const existing = await tx.maintenanceProcurementRequirement.findUnique({
          where: {
            organisationId_idempotencyKey: {
              organisationId: data.organisationId,
              idempotencyKey: data.idempotencyKey,
            },
          },
        });
        if (existing) {
          return { requirement: existing, wasCreated: false };
        }
      }

      const requirement = await tx.maintenanceProcurementRequirement.create({
        data: {
          organisationId: data.organisationId,
          workOrderId: data.workOrderId,
          description: data.description,
          estimatedCost: data.estimatedCost,
          supplierId: data.supplierId,
          idempotencyKey: data.idempotencyKey,
          createdById: data.createdById,
        },
      });

      return { requirement, wasCreated: true };
    });
  }

  /** Attaches an already-existing, already-tenant-validated Purchase
   *  Order id (validated by the service layer via the read-only
   *  `PurchaseOrderRepository` before this is ever called) — never
   *  creates or mutates the Purchase Order itself. Soft-idempotent: an
   *  already-`LINKED` row with the same `purchaseOrderId` returns
   *  unchanged; linking a *different* PO onto an already-linked row is a
   *  genuine conflict. */
  async link(
    data: LinkProcurementRequirementData,
  ): Promise<{ requirement: MaintenanceProcurementRequirement; wasLinked: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      const requirement = await tx.maintenanceProcurementRequirement.findFirst({
        where: { id: data.requirementId, organisationId: data.organisationId },
      });
      if (!requirement) {
        throw new ProcurementRequirementNotFoundError('Procurement requirement not found');
      }
      if (requirement.status === 'LINKED') {
        if (requirement.purchaseOrderId === data.purchaseOrderId) {
          return { requirement, wasLinked: false };
        }
        throw new ProcurementRequirementStatusConflictError(
          'This requirement is already linked to a different purchase order',
        );
      }
      if (requirement.status !== 'IDENTIFIED') {
        throw new ProcurementRequirementStatusConflictError(
          `Cannot link a requirement in status ${requirement.status}`,
        );
      }

      const updated = await tx.maintenanceProcurementRequirement.update({
        where: { id: requirement.id },
        data: {
          status: 'LINKED',
          purchaseOrderId: data.purchaseOrderId,
          linkedAt: new Date(),
        },
      });
      return { requirement: updated, wasLinked: true };
    });
  }

  async cancel(
    organisationId: string,
    requirementId: string,
  ): Promise<{ requirement: MaintenanceProcurementRequirement }> {
    return this.prisma.$transaction(async (tx) => {
      const requirement = await tx.maintenanceProcurementRequirement.findFirst({
        where: { id: requirementId, organisationId },
      });
      if (!requirement) {
        throw new ProcurementRequirementNotFoundError('Procurement requirement not found');
      }
      if (requirement.status === 'CANCELLED') {
        return { requirement };
      }
      if (requirement.status !== 'IDENTIFIED') {
        throw new ProcurementRequirementStatusConflictError(
          `Cannot cancel a requirement in status ${requirement.status} — it is already linked to a purchase order`,
        );
      }
      const updated = await tx.maintenanceProcurementRequirement.update({
        where: { id: requirement.id },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
      return { requirement: updated };
    });
  }

  /** Narrow, documented, read-only reach directly into `supplierInvoice`
   *  (Sprint 22, docs/domains/maintenance-integration.md "Supplier/AP
   *  Integration") — the exact same query shape
   *  `SupplierInvoiceRepository.getApByPurchaseOrder()` already uses
   *  (Sprint 12), reproduced here rather than imported because
   *  `FinanceModule` exports nothing. Mirrors the established
   *  `AssetRepository.findCapitalProjectRef()` precedent (Sprint 18/20):
   *  a plain `this.prisma.<financeTable>.findFirst/aggregate(...)` call,
   *  never a write, never a `FinanceModule` import. */
  async getApSummaryForPurchaseOrder(
    organisationId: string,
    purchaseOrderId: string,
  ): Promise<{
    invoicedTotal: number;
    recognizedAmount: number;
    amountPaid: number;
    amountOutstanding: number;
    discrepancyCount: number;
  }> {
    const [aggregate, discrepancyCount] = await Promise.all([
      this.prisma.supplierInvoice.aggregate({
        where: { organisationId, purchaseOrderId, status: { not: 'VOID' } },
        _sum: { total: true, recognizedAmount: true, amountPaid: true, amountCredited: true },
      }),
      this.prisma.supplierInvoice.count({
        where: { organisationId, purchaseOrderId, matchStatus: 'DISCREPANCY' },
      }),
    ]);
    const recognizedAmount = aggregate._sum.recognizedAmount ?? 0;
    const amountPaid = aggregate._sum.amountPaid ?? 0;
    const amountCredited = aggregate._sum.amountCredited ?? 0;
    return {
      invoicedTotal: aggregate._sum.total ?? 0,
      recognizedAmount,
      amountPaid,
      amountOutstanding: Math.max(0, recognizedAmount - amountPaid - amountCredited),
      discrepancyCount,
    };
  }
}
