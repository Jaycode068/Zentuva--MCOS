import { Injectable } from '@nestjs/common';
import { MaintenanceCost, MaintenanceCostCategory } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export interface RecordMaintenanceCostData {
  organisationId: string;
  workOrderId: string;
  category: MaintenanceCostCategory;
  description?: string;
  quantity: number;
  unitCost: number;
  currency: string;
  supplierId?: string;
  costCentreId?: string;
  referenceType?: string;
  referenceId?: string;
  idempotencyKey?: string;
  recordedById: string;
}

export interface RecordMaintenanceCostResult {
  cost: MaintenanceCost;
  wasCreated: boolean;
}

/**
 * Thin Prisma access for `MaintenanceCost` (Sprint 21, docs/domains/
 * maintenance.md "Cost Boundary"). `totalCost` is always server-computed
 * here (`quantity × unitCost`) — a client-supplied total is never
 * accepted or trusted. Never calls `postSystemJournalEntry`; never writes
 * `journalEntry`/`supplierInvoice`/`payment` — proven by
 * `maintenance-independence.spec.ts`.
 */
@Injectable()
export class MaintenanceCostRepository {
  constructor(private readonly prisma: PrismaService) {}

  findManyByWorkOrder(organisationId: string, workOrderId: string): Promise<MaintenanceCost[]> {
    return this.prisma.maintenanceCost.findMany({
      where: { organisationId, workOrderId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async record(data: RecordMaintenanceCostData): Promise<RecordMaintenanceCostResult> {
    return this.prisma.$transaction(async (tx) => {
      if (data.idempotencyKey) {
        const existing = await tx.maintenanceCost.findUnique({
          where: {
            organisationId_idempotencyKey: {
              organisationId: data.organisationId,
              idempotencyKey: data.idempotencyKey,
            },
          },
        });
        if (existing) {
          return { cost: existing, wasCreated: false };
        }
      }

      const totalCost = roundCurrency(data.quantity * data.unitCost);

      const cost = await tx.maintenanceCost.create({
        data: {
          organisationId: data.organisationId,
          workOrderId: data.workOrderId,
          category: data.category,
          description: data.description,
          quantity: data.quantity,
          unitCost: data.unitCost,
          totalCost,
          currency: data.currency,
          supplierId: data.supplierId,
          costCentreId: data.costCentreId,
          referenceType: data.referenceType,
          referenceId: data.referenceId,
          idempotencyKey: data.idempotencyKey,
          recordedById: data.recordedById,
        },
      });

      return { cost, wasCreated: true };
    });
  }
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
