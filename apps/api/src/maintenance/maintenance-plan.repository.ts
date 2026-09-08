import { Injectable } from '@nestjs/common';
import {
  MaintenancePlan,
  MaintenancePlanStatus,
  MaintenancePlanTask,
  MaintenancePriority,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export interface ListMaintenancePlansParams {
  status?: MaintenancePlanStatus;
  assetId?: string;
  assetCategoryId?: string;
  maintenanceTypeId?: string;
}

export interface CreateMaintenancePlanTaskData {
  title: string;
  description?: string;
  mandatory: boolean;
  estimatedDurationMinutes?: number;
}

export interface CreateMaintenancePlanData {
  organisationId: string;
  name: string;
  description?: string;
  maintenanceTypeId: string;
  assetId?: string;
  assetCategoryId?: string;
  priority: MaintenancePriority;
  estimatedDurationMinutes?: number;
  instructions?: string;
  safetyNotes?: string;
  tasks: CreateMaintenancePlanTaskData[];
  idempotencyKey?: string;
  createdById: string;
}

export interface MaintenancePlanWithTasks extends MaintenancePlan {
  tasks: MaintenancePlanTask[];
}

export interface CreateMaintenancePlanResult {
  maintenancePlan: MaintenancePlanWithTasks;
  wasCreated: boolean;
}

/**
 * Thin Prisma access for `MaintenancePlan`/`MaintenancePlanTask` (Sprint
 * 21, docs/domains/maintenance.md). `create()` is idempotency-check-first
 * inside a `$transaction` (a plan plus its checklist template is a
 * genuine multi-row creation, the `CapitalProjectRepository.create()`
 * shape, not the simpler catch-unique-violation master-data pattern
 * `MaintenanceTypeRepository` uses).
 */
@Injectable()
export class MaintenancePlanRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<MaintenancePlanWithTasks | null> {
    return this.prisma.maintenancePlan.findFirst({
      where: { id, organisationId },
      include: { tasks: { orderBy: { sequence: 'asc' } } },
    });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListMaintenancePlansParams = {},
  ): Promise<MaintenancePlan[]> {
    return this.prisma.maintenancePlan.findMany({
      where: {
        organisationId,
        ...(params.status ? { status: params.status } : {}),
        ...(params.assetId ? { assetId: params.assetId } : {}),
        ...(params.assetCategoryId ? { assetCategoryId: params.assetCategoryId } : {}),
        ...(params.maintenanceTypeId ? { maintenanceTypeId: params.maintenanceTypeId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(data: CreateMaintenancePlanData): Promise<CreateMaintenancePlanResult> {
    return this.prisma.$transaction(async (tx) => {
      if (data.idempotencyKey) {
        const existing = await tx.maintenancePlan.findUnique({
          where: {
            organisationId_idempotencyKey: {
              organisationId: data.organisationId,
              idempotencyKey: data.idempotencyKey,
            },
          },
          include: { tasks: { orderBy: { sequence: 'asc' } } },
        });
        if (existing) {
          return { maintenancePlan: existing, wasCreated: false };
        }
      }

      const maintenancePlan = await tx.maintenancePlan.create({
        data: {
          organisationId: data.organisationId,
          name: data.name,
          description: data.description,
          maintenanceTypeId: data.maintenanceTypeId,
          assetId: data.assetId,
          assetCategoryId: data.assetCategoryId,
          priority: data.priority,
          estimatedDurationMinutes: data.estimatedDurationMinutes,
          instructions: data.instructions,
          safetyNotes: data.safetyNotes,
          idempotencyKey: data.idempotencyKey,
          createdById: data.createdById,
          tasks: {
            create: data.tasks.map((task, index) => ({
              sequence: index + 1,
              title: task.title,
              description: task.description,
              mandatory: task.mandatory,
              estimatedDurationMinutes: task.estimatedDurationMinutes,
            })),
          },
        },
        include: { tasks: { orderBy: { sequence: 'asc' } } },
      });

      return { maintenancePlan, wasCreated: true };
    });
  }

  update(
    organisationId: string,
    id: string,
    data: Prisma.MaintenancePlanUncheckedUpdateInput,
  ): Promise<MaintenancePlan | null> {
    return this.updateMatching(organisationId, id, data);
  }

  deactivate(organisationId: string, id: string): Promise<MaintenancePlan | null> {
    return this.updateMatching(organisationId, id, { status: MaintenancePlanStatus.INACTIVE });
  }

  activate(organisationId: string, id: string): Promise<MaintenancePlan | null> {
    return this.updateMatching(organisationId, id, { status: MaintenancePlanStatus.ACTIVE });
  }

  private async updateMatching(
    organisationId: string,
    id: string,
    data: Prisma.MaintenancePlanUncheckedUpdateInput,
  ): Promise<MaintenancePlan | null> {
    const result = await this.prisma.maintenancePlan.updateMany({
      where: { id, organisationId },
      data,
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.maintenancePlan.findUniqueOrThrow({ where: { id } });
  }
}
