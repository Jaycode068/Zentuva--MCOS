import { Injectable } from '@nestjs/common';
import { CapitalProjectCostLine, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export interface CreateCapitalProjectCostLineData {
  capitalProjectId: string;
  description: string;
  category?: string;
  plannedAmount: number;
  chartOfAccountId?: string;
  costCentreId?: string;
  plannedMonth: Date;
  purchaseOrderId?: string;
  notes?: string;
  createdById: string;
}

/**
 * Thin Prisma access for `CapitalProjectCostLine` (Sprint 18, docs/domains/
 * investment-projects.md §8) — a project's planned cost breakdown. The
 * server-computed `plannedCost` total is always `Σ plannedAmount`, derived
 * on every read by `CapitalProjectService`, never stored here.
 */
@Injectable()
export class CapitalProjectCostLineRepository {
  constructor(private readonly prisma: PrismaService) {}

  findManyByProject(capitalProjectId: string): Promise<CapitalProjectCostLine[]> {
    return this.prisma.capitalProjectCostLine.findMany({
      where: { capitalProjectId },
      orderBy: { plannedMonth: 'asc' },
    });
  }

  findById(id: string): Promise<CapitalProjectCostLine | null> {
    return this.prisma.capitalProjectCostLine.findUnique({ where: { id } });
  }

  create(data: CreateCapitalProjectCostLineData): Promise<CapitalProjectCostLine> {
    return this.prisma.capitalProjectCostLine.create({
      data: {
        capitalProjectId: data.capitalProjectId,
        description: data.description,
        category: data.category,
        plannedAmount: data.plannedAmount,
        chartOfAccountId: data.chartOfAccountId,
        costCentreId: data.costCentreId,
        plannedMonth: data.plannedMonth,
        purchaseOrderId: data.purchaseOrderId,
        notes: data.notes,
        createdById: data.createdById,
        updatedById: data.createdById,
      },
    });
  }

  async update(
    id: string,
    data: Prisma.CapitalProjectCostLineUncheckedUpdateInput,
  ): Promise<CapitalProjectCostLine | null> {
    const result = await this.prisma.capitalProjectCostLine.updateMany({ where: { id }, data });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.capitalProjectCostLine.findUniqueOrThrow({ where: { id } });
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.prisma.capitalProjectCostLine.deleteMany({ where: { id } });
    return result.count > 0;
  }
}
