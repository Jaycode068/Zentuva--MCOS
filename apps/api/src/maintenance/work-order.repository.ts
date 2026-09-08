import { BadRequestException, Injectable } from '@nestjs/common';
import {
  AssetMeterType,
  MaintenancePriority,
  Prisma,
  WorkOrder,
  WorkOrderStatus,
  WorkOrderTask,
} from '@prisma/client';

import { recordMeterReadingWithinTransaction } from '../assets/asset-meter.repository';
import { PrismaService } from '../prisma/prisma.service';
import { generateWorkOrderCode } from './work-order-code';

export interface ListWorkOrdersParams {
  status?: WorkOrderStatus;
  priority?: MaintenancePriority;
  assetId?: string;
  assignedToId?: string;
  maintenanceTypeId?: string;
  isPreventive?: boolean;
  search?: string;
}

export interface CreateWorkOrderData {
  organisationId: string;
  assetId: string;
  maintenanceTypeId: string;
  maintenanceRequestId?: string;
  title: string;
  description?: string;
  priority: MaintenancePriority;
  assignedToId?: string;
  plannedStartAt?: Date;
  plannedEndAt?: Date;
  failureReason?: string;
  isExternalService: boolean;
  externalSupplierId?: string;
  externalProviderName?: string;
  externalReference?: string;
  externalSentAt?: Date;
  notes?: string;
  idempotencyKey?: string;
  createdById: string;
}

export interface CreateWorkOrderResult {
  workOrder: WorkOrder;
  wasCreated: boolean;
}

export interface CompleteWorkOrderData {
  organisationId: string;
  workOrderId: string;
  resolution: string;
  rootCause?: string;
  correctiveAction?: string;
  notes?: string;
  meterReading?: number;
  meterType?: AssetMeterType;
  externalReturnedAt?: Date;
  idempotencyKey?: string;
  actorUserId: string;
}

export interface CompleteWorkOrderResult {
  workOrder: WorkOrder;
  wasCompleted: boolean;
}

export class IncompleteMandatoryTasksError extends Error {
  constructor(public readonly pendingTaskTitles: string[]) {
    super(
      `Cannot complete this work order — mandatory tasks are still incomplete: ${pendingTaskTitles.join(', ')}`,
    );
  }
}

export class AmbiguousMeterError extends Error {
  constructor() {
    super('This asset has more than one meter — specify which meterType this reading applies to');
  }
}

export type WorkOrderWithTasks = WorkOrder & { tasks: WorkOrderTask[] };

/**
 * Thin Prisma access for `WorkOrder` (Sprint 21, docs/domains/
 * maintenance.md "Work Order Lifecycle"). `workOrderCode` generation
 * mirrors `AssetRepository.generateAssetCode()` exactly (Sprint 20).
 * `complete()` is the single most important transaction in this domain:
 * validates every mandatory task is `COMPLETED`, records resolution/root-
 * cause/completion timestamps, auto-closes any still-open `AssetDowntime`
 * row for this work order, and — if a meter reading was supplied — records
 * it via Sprint 20's own `recordMeterReadingWithinTransaction()` (never a
 * duplicated meter-write) — all inside one transaction, or none of it.
 * The `Asset` lifecycle transition (`UNDER_MAINTENANCE → IN_SERVICE`) is a
 * deliberate second, best-effort step taken by the *service* layer after
 * this transaction commits, via `AssetService`'s own boundary — see
 * `work-order.service.ts`'s own doc comment for why.
 */
@Injectable()
export class WorkOrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<WorkOrderWithTasks | null> {
    return this.prisma.workOrder.findFirst({
      where: { id, organisationId },
      include: { tasks: { orderBy: { sequence: 'asc' } } },
    });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListWorkOrdersParams = {},
  ): Promise<WorkOrder[]> {
    return this.prisma.workOrder.findMany({
      where: {
        organisationId,
        ...(params.status ? { status: params.status } : {}),
        ...(params.priority ? { priority: params.priority } : {}),
        ...(params.assetId ? { assetId: params.assetId } : {}),
        ...(params.assignedToId ? { assignedToId: params.assignedToId } : {}),
        ...(params.maintenanceTypeId ? { maintenanceTypeId: params.maintenanceTypeId } : {}),
        ...(params.isPreventive === true ? { maintenancePlanId: { not: null } } : {}),
        ...(params.isPreventive === false ? { maintenancePlanId: null } : {}),
        ...(params.search
          ? {
              OR: [
                { workOrderCode: { contains: params.search, mode: 'insensitive' } },
                { title: { contains: params.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(data: CreateWorkOrderData): Promise<CreateWorkOrderResult> {
    return this.prisma.$transaction(async (tx) => {
      if (data.idempotencyKey) {
        const existing = await tx.workOrder.findUnique({
          where: {
            organisationId_idempotencyKey: {
              organisationId: data.organisationId,
              idempotencyKey: data.idempotencyKey,
            },
          },
        });
        if (existing) {
          return { workOrder: existing, wasCreated: false };
        }
      }

      const workOrderCode = await generateWorkOrderCode(tx, data.organisationId);

      const workOrder = await tx.workOrder.create({
        data: {
          organisationId: data.organisationId,
          workOrderCode,
          assetId: data.assetId,
          maintenanceTypeId: data.maintenanceTypeId,
          maintenanceRequestId: data.maintenanceRequestId,
          title: data.title,
          description: data.description,
          priority: data.priority,
          status: data.assignedToId ? 'ASSIGNED' : 'OPEN',
          assignedToId: data.assignedToId,
          plannedStartAt: data.plannedStartAt,
          plannedEndAt: data.plannedEndAt,
          failureReason: data.failureReason,
          isExternalService: data.isExternalService,
          externalSupplierId: data.externalSupplierId,
          externalProviderName: data.externalProviderName,
          externalReference: data.externalReference,
          externalSentAt: data.externalSentAt,
          notes: data.notes,
          idempotencyKey: data.idempotencyKey,
          createdById: data.createdById,
        },
      });

      return { workOrder, wasCreated: true };
    });
  }

  update(
    organisationId: string,
    id: string,
    data: Prisma.WorkOrderUncheckedUpdateInput,
  ): Promise<WorkOrder | null> {
    return this.updateMatching(organisationId, id, data);
  }

  setStatus(
    organisationId: string,
    id: string,
    data: Prisma.WorkOrderUncheckedUpdateInput,
  ): Promise<WorkOrder | null> {
    return this.updateMatching(organisationId, id, data);
  }

  /**
   * Atomic: validates every mandatory `WorkOrderTask` is `COMPLETED`,
   * writes completion facts, closes any still-open downtime window, and
   * — if requested — records a meter reading via Sprint 20's own
   * transaction-joinable meter-recording function. Idempotency-check-
   * first, before the mandatory-task precheck (the Sprint 9/10 lesson).
   */
  async complete(data: CompleteWorkOrderData): Promise<CompleteWorkOrderResult> {
    return this.prisma.$transaction(async (tx) => {
      const workOrder = await tx.workOrder.findFirstOrThrow({
        where: { id: data.workOrderId, organisationId: data.organisationId },
        include: { tasks: true },
      });

      if (workOrder.status === 'COMPLETED') {
        return { workOrder, wasCompleted: false };
      }
      if (workOrder.status === 'CANCELLED') {
        throw new BadRequestException('Cannot complete a cancelled work order');
      }
      if (data.idempotencyKey && workOrder.idempotencyKey === data.idempotencyKey) {
        return { workOrder, wasCompleted: false };
      }

      const incompleteMandatory = workOrder.tasks.filter(
        (task) => task.mandatory && task.status !== 'COMPLETED',
      );
      if (incompleteMandatory.length > 0) {
        throw new IncompleteMandatoryTasksError(incompleteMandatory.map((t) => t.title));
      }

      const now = new Date();

      const openDowntime = await tx.assetDowntime.findFirst({
        where: { organisationId: data.organisationId, workOrderId: workOrder.id, endedAt: null },
      });
      if (openDowntime) {
        await tx.assetDowntime.update({ where: { id: openDowntime.id }, data: { endedAt: now } });
      }

      let meterReadingId: string | undefined;
      if (data.meterReading !== undefined) {
        const meters = await tx.assetMeter.findMany({
          where: { organisationId: data.organisationId, assetId: workOrder.assetId },
        });
        const meter = data.meterType
          ? meters.find((m) => m.meterType === data.meterType)
          : meters.length === 1
            ? meters[0]
            : undefined;
        if (!meter) {
          if (meters.length > 1) {
            throw new AmbiguousMeterError();
          }
          throw new BadRequestException('This asset has no meter to record a reading against');
        }
        const result = await recordMeterReadingWithinTransaction(tx, {
          organisationId: data.organisationId,
          meterId: meter.id,
          reading: data.meterReading,
          readingDate: now,
          recordedById: data.actorUserId,
        });
        meterReadingId = result.reading.id;
      }

      const updated = await tx.workOrder.update({
        where: { id: workOrder.id },
        data: {
          status: 'COMPLETED',
          completedAt: now,
          actualEndAt: workOrder.actualEndAt ?? now,
          resolution: data.resolution,
          rootCause: data.rootCause,
          correctiveAction: data.correctiveAction,
          notes: data.notes ?? workOrder.notes,
          meterReadingId,
          externalReturnedAt: data.externalReturnedAt,
          idempotencyKey: data.idempotencyKey ?? workOrder.idempotencyKey,
        },
      });

      return { workOrder: updated, wasCompleted: true };
    });
  }

  countOpenForAsset(organisationId: string, assetId: string, excludeId?: string): Promise<number> {
    return this.prisma.workOrder.count({
      where: {
        organisationId,
        assetId,
        status: { in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'] },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
  }

  // === Tasks ===

  findTasks(workOrderId: string): Promise<WorkOrderTask[]> {
    return this.prisma.workOrderTask.findMany({
      where: { workOrderId },
      orderBy: { sequence: 'asc' },
    });
  }

  async addTask(
    workOrderId: string,
    data: {
      title: string;
      description?: string;
      mandatory: boolean;
      assignedToId?: string;
      estimatedDurationMinutes?: number;
    },
  ): Promise<WorkOrderTask> {
    const last = await this.prisma.workOrderTask.findFirst({
      where: { workOrderId },
      orderBy: { sequence: 'desc' },
    });
    return this.prisma.workOrderTask.create({
      data: {
        workOrderId,
        sequence: (last?.sequence ?? 0) + 1,
        title: data.title,
        description: data.description,
        mandatory: data.mandatory,
        assignedToId: data.assignedToId,
        estimatedDurationMinutes: data.estimatedDurationMinutes,
      },
    });
  }

  async updateTask(
    workOrderId: string,
    taskId: string,
    data: Prisma.WorkOrderTaskUncheckedUpdateInput,
  ): Promise<WorkOrderTask | null> {
    const result = await this.prisma.workOrderTask.updateMany({
      where: { id: taskId, workOrderId },
      data,
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.workOrderTask.findUniqueOrThrow({ where: { id: taskId } });
  }

  private async updateMatching(
    organisationId: string,
    id: string,
    data: Prisma.WorkOrderUncheckedUpdateInput,
  ): Promise<WorkOrder | null> {
    const result = await this.prisma.workOrder.updateMany({ where: { id, organisationId }, data });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.workOrder.findUniqueOrThrow({ where: { id } });
  }
}
