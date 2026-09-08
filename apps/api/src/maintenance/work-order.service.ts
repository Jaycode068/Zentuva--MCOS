import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { WorkOrder, WorkOrderStatus } from '@prisma/client';
import {
  CompleteWorkOrderInput,
  CreateWorkOrderInput,
  UpdateWorkOrderInput,
} from '@zentuva/validation';

import { InvalidMeterReadingError } from '../assets/asset-meter.repository';
import { AssetRepository } from '../assets/asset.repository';
import { AssetService } from '../assets/asset.service';
import { SupplierRepository } from '../suppliers/supplier/supplier.repository';
import { MaintenanceRequestRepository } from './maintenance-request.repository';
import { MaintenanceTypeRepository } from './maintenance-type.repository';
import {
  AmbiguousMeterError,
  CompleteWorkOrderResult,
  CreateWorkOrderResult,
  IncompleteMandatoryTasksError,
  ListWorkOrdersParams,
  WorkOrderRepository,
  WorkOrderWithTasks,
} from './work-order.repository';

const TERMINAL_STATUSES: WorkOrderStatus[] = ['COMPLETED', 'CANCELLED'];

/**
 * Domain service for `WorkOrder` (Sprint 21, docs/domains/maintenance.md
 * "Work Order Lifecycle" / "Asset Status Interaction"). Owns the
 * lifecycle transitions and the Asset-status side effect
 * (`IN_SERVICE ⇄ UNDER_MAINTENANCE`), always via the injected
 * `AssetService`'s own lifecycle methods — never a raw Prisma update
 * against the `asset` table (proven by `maintenance-independence.spec.ts`).
 *
 * **Why the Asset transition is a second, best-effort step, not inside
 * `WorkOrderRepository`'s own transaction**: `AssetService`'s lifecycle
 * methods are themselves a second, independent unit of work (their own
 * DB round-trips through a different repository) — nesting them inside
 * `WorkOrderRepository.complete()`'s own `$transaction` would mean
 * holding that transaction open across a second service's calls, which
 * this codebase's own convention explicitly avoids ("do not hold
 * transactions open across external network calls/other services' own
 * transactions"). The work order's own completion facts (tasks,
 * downtime, meter reading, resolution) are always atomic on their own;
 * the Asset status flip is applied immediately after, and only when the
 * asset is actually in the expected prior state (never forcing an
 * invalid Asset transition) — a documented, deliberate two-phase design.
 */
@Injectable()
export class WorkOrderService {
  constructor(
    private readonly workOrderRepository: WorkOrderRepository,
    private readonly assetRepository: AssetRepository,
    private readonly assetService: AssetService,
    private readonly maintenanceTypeRepository: MaintenanceTypeRepository,
    private readonly maintenanceRequestRepository: MaintenanceRequestRepository,
    private readonly supplierRepository: SupplierRepository,
  ) {}

  getById(organisationId: string, id: string): Promise<WorkOrderWithTasks> {
    return this.getByIdOrThrow(organisationId, id);
  }

  list(organisationId: string, params?: ListWorkOrdersParams) {
    return this.workOrderRepository.findManyByOrganisation(organisationId, params);
  }

  async create(
    organisationId: string,
    input: CreateWorkOrderInput,
    actorUserId: string,
  ): Promise<CreateWorkOrderResult> {
    const asset = await this.assetRepository.findById(organisationId, input.assetId);
    if (!asset) {
      throw new BadRequestException('Asset not found');
    }
    const maintenanceType = await this.maintenanceTypeRepository.findById(
      organisationId,
      input.maintenanceTypeId,
    );
    if (!maintenanceType) {
      throw new BadRequestException('Maintenance type not found');
    }
    if (input.maintenanceRequestId) {
      const request = await this.maintenanceRequestRepository.findById(
        organisationId,
        input.maintenanceRequestId,
      );
      if (!request) {
        throw new BadRequestException('Maintenance request not found');
      }
    }
    if (input.externalSupplierId) {
      const supplier = await this.supplierRepository.findById(
        organisationId,
        input.externalSupplierId,
      );
      if (!supplier) {
        throw new BadRequestException('Supplier not found');
      }
    }

    return this.workOrderRepository.create({
      organisationId,
      assetId: input.assetId,
      maintenanceTypeId: input.maintenanceTypeId,
      maintenanceRequestId: input.maintenanceRequestId,
      title: input.title,
      description: input.description,
      priority: input.priority,
      assignedToId: input.assignedToId,
      plannedStartAt: input.plannedStartAt,
      plannedEndAt: input.plannedEndAt,
      failureReason: input.failureReason,
      isExternalService: input.isExternalService,
      externalSupplierId: input.externalSupplierId,
      externalProviderName: input.externalProviderName,
      externalReference: input.externalReference,
      externalSentAt: input.externalSentAt,
      notes: input.notes,
      idempotencyKey: input.idempotencyKey,
      createdById: actorUserId,
    });
  }

  async update(
    organisationId: string,
    id: string,
    input: UpdateWorkOrderInput,
  ): Promise<WorkOrder> {
    const workOrder = await this.getByIdOrThrow(organisationId, id);
    if (workOrder.status !== 'OPEN' && workOrder.status !== 'ASSIGNED') {
      throw new BadRequestException(
        `Cannot edit a work order once it is ${workOrder.status.toLowerCase()} — only OPEN/ASSIGNED work orders are editable`,
      );
    }
    const updated = await this.workOrderRepository.update(organisationId, id, {
      title: input.title,
      description: input.description,
      priority: input.priority,
      plannedStartAt: input.plannedStartAt,
      plannedEndAt: input.plannedEndAt,
      failureReason: input.failureReason,
      notes: input.notes,
    });
    if (!updated) {
      throw new NotFoundException('Work order not found');
    }
    return updated;
  }

  async assign(
    organisationId: string,
    id: string,
    assignedToId: string,
  ): Promise<{ workOrder: WorkOrder; transitioned: boolean }> {
    const workOrder = await this.getByIdOrThrow(organisationId, id);
    this.assertNotTerminal(workOrder);

    const nextStatus = workOrder.status === 'OPEN' ? 'ASSIGNED' : workOrder.status;
    const updated = await this.workOrderRepository.setStatus(organisationId, id, {
      assignedToId,
      status: nextStatus,
    });
    if (!updated) {
      throw new NotFoundException('Work order not found');
    }
    return { workOrder: updated, transitioned: true };
  }

  async start(
    organisationId: string,
    id: string,
  ): Promise<{ workOrder: WorkOrder; transitioned: boolean }> {
    const workOrder = await this.getByIdOrThrow(organisationId, id);
    this.assertNotTerminal(workOrder);

    if (workOrder.status === 'IN_PROGRESS') {
      return { workOrder, transitioned: false };
    }
    if (workOrder.status !== 'ASSIGNED') {
      throw new BadRequestException(
        `Cannot start a ${workOrder.status.toLowerCase()} work order — assign a technician first`,
      );
    }

    const updated = await this.workOrderRepository.setStatus(organisationId, id, {
      status: 'IN_PROGRESS',
      actualStartAt: workOrder.actualStartAt ?? new Date(),
    });
    if (!updated) {
      throw new NotFoundException('Work order not found');
    }

    await this.tryStartAssetMaintenance(organisationId, updated.assetId);
    return { workOrder: updated, transitioned: true };
  }

  async hold(
    organisationId: string,
    id: string,
    reason?: string,
  ): Promise<{ workOrder: WorkOrder; transitioned: boolean }> {
    const workOrder = await this.getByIdOrThrow(organisationId, id);
    this.assertNotTerminal(workOrder);

    if (workOrder.status === 'ON_HOLD') {
      return { workOrder, transitioned: false };
    }
    if (workOrder.status !== 'IN_PROGRESS') {
      throw new BadRequestException(
        `Cannot hold a ${workOrder.status.toLowerCase()} work order — it must be in progress`,
      );
    }

    const updated = await this.workOrderRepository.setStatus(organisationId, id, {
      status: 'ON_HOLD',
      notes: reason
        ? [workOrder.notes, `On hold: ${reason}`].filter(Boolean).join('\n')
        : workOrder.notes,
    });
    if (!updated) {
      throw new NotFoundException('Work order not found');
    }
    return { workOrder: updated, transitioned: true };
  }

  async resume(
    organisationId: string,
    id: string,
  ): Promise<{ workOrder: WorkOrder; transitioned: boolean }> {
    const workOrder = await this.getByIdOrThrow(organisationId, id);
    this.assertNotTerminal(workOrder);

    if (workOrder.status === 'IN_PROGRESS') {
      return { workOrder, transitioned: false };
    }
    if (workOrder.status !== 'ON_HOLD') {
      throw new BadRequestException(
        `Cannot resume a ${workOrder.status.toLowerCase()} work order — it must be on hold`,
      );
    }

    const updated = await this.workOrderRepository.setStatus(organisationId, id, {
      status: 'IN_PROGRESS',
    });
    if (!updated) {
      throw new NotFoundException('Work order not found');
    }
    return { workOrder: updated, transitioned: true };
  }

  async cancel(
    organisationId: string,
    id: string,
    reason?: string,
  ): Promise<{ workOrder: WorkOrder; transitioned: boolean }> {
    const workOrder = await this.getByIdOrThrow(organisationId, id);

    if (workOrder.status === 'CANCELLED') {
      return { workOrder, transitioned: false };
    }
    if (workOrder.status === 'COMPLETED') {
      throw new BadRequestException('Cannot cancel a completed work order');
    }

    const updated = await this.workOrderRepository.setStatus(organisationId, id, {
      status: 'CANCELLED',
      notes: reason
        ? [workOrder.notes, `Cancelled: ${reason}`].filter(Boolean).join('\n')
        : workOrder.notes,
    });
    if (!updated) {
      throw new NotFoundException('Work order not found');
    }

    await this.tryResumeAssetService(organisationId, updated.assetId, updated.id);
    return { workOrder: updated, transitioned: true };
  }

  async complete(
    organisationId: string,
    id: string,
    input: CompleteWorkOrderInput,
    actorUserId: string,
  ): Promise<CompleteWorkOrderResult> {
    const workOrder = await this.getByIdOrThrow(organisationId, id);
    if (workOrder.status !== 'IN_PROGRESS' && workOrder.status !== 'COMPLETED') {
      throw new BadRequestException(
        `Cannot complete a ${workOrder.status.toLowerCase()} work order — it must be in progress`,
      );
    }

    let result: CompleteWorkOrderResult;
    try {
      result = await this.workOrderRepository.complete({
        organisationId,
        workOrderId: id,
        resolution: input.resolution,
        rootCause: input.rootCause,
        correctiveAction: input.correctiveAction,
        notes: input.notes,
        meterReading: input.meterReading,
        meterType: input.meterType,
        externalReturnedAt: input.externalReturnedAt,
        idempotencyKey: input.idempotencyKey,
        actorUserId,
      });
    } catch (error) {
      if (
        error instanceof IncompleteMandatoryTasksError ||
        error instanceof AmbiguousMeterError ||
        error instanceof InvalidMeterReadingError
      ) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    if (result.wasCompleted) {
      await this.tryResumeAssetService(organisationId, result.workOrder.assetId, id);
    }
    return result;
  }

  // === Tasks ===

  listTasks(workOrderId: string) {
    return this.workOrderRepository.findTasks(workOrderId);
  }

  async addTask(
    organisationId: string,
    workOrderId: string,
    input: {
      title: string;
      description?: string;
      mandatory: boolean;
      assignedToId?: string;
      estimatedDurationMinutes?: number;
    },
  ) {
    const workOrder = await this.getByIdOrThrow(organisationId, workOrderId);
    this.assertNotTerminal(workOrder);
    return this.workOrderRepository.addTask(workOrderId, input);
  }

  async updateTask(
    organisationId: string,
    workOrderId: string,
    taskId: string,
    input: { status?: string; actualDurationMinutes?: number; notes?: string | null },
  ) {
    const workOrder = await this.getByIdOrThrow(organisationId, workOrderId);
    this.assertNotTerminal(workOrder);

    const updated = await this.workOrderRepository.updateTask(workOrderId, taskId, {
      status: input.status as never,
      actualDurationMinutes: input.actualDurationMinutes,
      notes: input.notes,
      completedAt: input.status === 'COMPLETED' ? new Date() : undefined,
    });
    if (!updated) {
      throw new NotFoundException('Work order task not found');
    }
    return updated;
  }

  private assertNotTerminal(workOrder: WorkOrder): void {
    if (TERMINAL_STATUSES.includes(workOrder.status)) {
      throw new BadRequestException(
        `Cannot modify a ${workOrder.status.toLowerCase()} work order — it is a terminal state`,
      );
    }
  }

  /** Only flips the asset IN_SERVICE → UNDER_MAINTENANCE when the asset is
   *  actually IN_SERVICE — never forces an invalid Asset transition, and
   *  never blocks the work order itself if the asset is in some other
   *  state (e.g. still DRAFT/ACTIVE, or already UNDER_MAINTENANCE from
   *  another concurrent work order, in which case Asset's own
   *  soft-idempotent transition is simply a no-op). */
  private async tryStartAssetMaintenance(organisationId: string, assetId: string): Promise<void> {
    const asset = await this.assetRepository.findById(organisationId, assetId);
    if (asset?.status === 'IN_SERVICE') {
      await this.assetService.startMaintenance(organisationId, assetId);
    }
  }

  /** Only flips the asset UNDER_MAINTENANCE → IN_SERVICE when no other
   *  work order on this asset is still open — otherwise leaves it
   *  UNDER_MAINTENANCE, since other active work remains (documented
   *  limitation: this is a simple "any open work order" check, not a
   *  full reservation/locking system). */
  private async tryResumeAssetService(
    organisationId: string,
    assetId: string,
    excludeWorkOrderId: string,
  ): Promise<void> {
    const asset = await this.assetRepository.findById(organisationId, assetId);
    if (asset?.status !== 'UNDER_MAINTENANCE') {
      return;
    }
    const stillOpen = await this.workOrderRepository.countOpenForAsset(
      organisationId,
      assetId,
      excludeWorkOrderId,
    );
    if (stillOpen === 0) {
      await this.assetService.resumeService(organisationId, assetId);
    }
  }

  private async getByIdOrThrow(organisationId: string, id: string): Promise<WorkOrderWithTasks> {
    const workOrder = await this.workOrderRepository.findById(organisationId, id);
    if (!workOrder) {
      throw new NotFoundException('Work order not found');
    }
    return workOrder;
  }
}
