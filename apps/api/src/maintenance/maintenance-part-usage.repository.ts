import { Injectable } from '@nestjs/common';
import { MaintenancePartUsage, MaintenancePartUsageType } from '@prisma/client';

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

/**
 * Thin Prisma access for `MaintenancePartUsage` (Sprint 21, docs/domains/
 * maintenance.md "Parts / Material Usage Boundary"). Records intended/
 * actual consumption only — `inventoryTransactionId` always stays null;
 * this file never writes `inventoryStock`/`inventoryTransaction`, proven
 * by `maintenance-independence.spec.ts`.
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
}
