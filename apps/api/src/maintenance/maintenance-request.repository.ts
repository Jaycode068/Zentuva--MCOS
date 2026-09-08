import { Injectable } from '@nestjs/common';
import {
  MaintenanceIssueType,
  MaintenancePriority,
  MaintenanceRequest,
  MaintenanceRequestStatus,
  Prisma,
  WorkOrder,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { generateWorkOrderCode } from './work-order-code';

const REQUEST_CODE_PREFIX = 'MR';
const REQUEST_CODE_SEQUENCE_LENGTH = 6;

export interface ConvertMaintenanceRequestData {
  organisationId: string;
  requestId: string;
  maintenanceTypeId: string;
  plannedStartAt?: Date;
  plannedEndAt?: Date;
  assignedToId?: string;
  idempotencyKey?: string;
  createdById: string;
}

export interface ConvertMaintenanceRequestResult {
  maintenanceRequest: MaintenanceRequest;
  workOrder: WorkOrder;
  wasCreated: boolean;
}

export interface ListMaintenanceRequestsParams {
  status?: MaintenanceRequestStatus;
  assetId?: string;
  priority?: MaintenancePriority;
}

export interface CreateMaintenanceRequestData {
  organisationId: string;
  assetId: string;
  title: string;
  description?: string;
  priority: MaintenancePriority;
  issueType?: MaintenanceIssueType;
  requestedDueDate?: Date;
  notes?: string;
  idempotencyKey?: string;
  createdById: string;
}

export interface CreateMaintenanceRequestResult {
  maintenanceRequest: MaintenanceRequest;
  wasCreated: boolean;
}

/**
 * Thin Prisma access for `MaintenanceRequest` (Sprint 21, docs/domains/
 * maintenance.md). `requestCode` generation mirrors `AssetRepository.
 * generateAssetCode()` exactly (Sprint 20) — concurrency-safe inside the
 * create `$transaction`.
 */
@Injectable()
export class MaintenanceRequestRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<MaintenanceRequest | null> {
    return this.prisma.maintenanceRequest.findFirst({ where: { id, organisationId } });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListMaintenanceRequestsParams = {},
  ): Promise<MaintenanceRequest[]> {
    return this.prisma.maintenanceRequest.findMany({
      where: {
        organisationId,
        ...(params.status ? { status: params.status } : {}),
        ...(params.assetId ? { assetId: params.assetId } : {}),
        ...(params.priority ? { priority: params.priority } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(data: CreateMaintenanceRequestData): Promise<CreateMaintenanceRequestResult> {
    return this.prisma.$transaction(async (tx) => {
      if (data.idempotencyKey) {
        const existing = await tx.maintenanceRequest.findUnique({
          where: {
            organisationId_idempotencyKey: {
              organisationId: data.organisationId,
              idempotencyKey: data.idempotencyKey,
            },
          },
        });
        if (existing) {
          return { maintenanceRequest: existing, wasCreated: false };
        }
      }

      const requestCode = await this.generateRequestCode(tx, data.organisationId);

      const maintenanceRequest = await tx.maintenanceRequest.create({
        data: {
          organisationId: data.organisationId,
          requestCode,
          assetId: data.assetId,
          title: data.title,
          description: data.description,
          priority: data.priority,
          issueType: data.issueType,
          requestedDueDate: data.requestedDueDate,
          notes: data.notes,
          idempotencyKey: data.idempotencyKey,
          createdById: data.createdById,
          reportedById: data.createdById,
        },
      });

      return { maintenanceRequest, wasCreated: true };
    });
  }

  update(
    organisationId: string,
    id: string,
    data: Prisma.MaintenanceRequestUncheckedUpdateInput,
  ): Promise<MaintenanceRequest | null> {
    return this.updateMatching(organisationId, id, data);
  }

  setStatus(
    organisationId: string,
    id: string,
    data: Prisma.MaintenanceRequestUncheckedUpdateInput,
  ): Promise<MaintenanceRequest | null> {
    return this.updateMatching(organisationId, id, data);
  }

  /**
   * Atomic: creates one `WorkOrder` from an `APPROVED` request and flips
   * the request to `CONVERTED_TO_WORK_ORDER` — or, if the request is
   * already converted, returns its existing `WorkOrder` unchanged
   * (natural idempotency by status, the same discipline every prior
   * sprint's soft-idempotent transitions use — a repeat `convert()` call
   * is never a business error, and never creates a second work order).
   */
  async convert(data: ConvertMaintenanceRequestData): Promise<ConvertMaintenanceRequestResult> {
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.maintenanceRequest.findFirstOrThrow({
        where: { id: data.requestId, organisationId: data.organisationId },
      });

      if (request.status === 'CONVERTED_TO_WORK_ORDER') {
        const existingWorkOrder = await tx.workOrder.findFirstOrThrow({
          where: { organisationId: data.organisationId, maintenanceRequestId: request.id },
        });
        return { maintenanceRequest: request, workOrder: existingWorkOrder, wasCreated: false };
      }

      if (data.idempotencyKey) {
        const existingWorkOrder = await tx.workOrder.findFirst({
          where: { organisationId: data.organisationId, idempotencyKey: data.idempotencyKey },
        });
        if (existingWorkOrder) {
          return { maintenanceRequest: request, workOrder: existingWorkOrder, wasCreated: false };
        }
      }

      const workOrderCode = await generateWorkOrderCode(tx, data.organisationId);
      const workOrder = await tx.workOrder.create({
        data: {
          organisationId: data.organisationId,
          workOrderCode,
          assetId: request.assetId,
          maintenanceTypeId: data.maintenanceTypeId,
          maintenanceRequestId: request.id,
          title: request.title,
          description: request.description,
          priority: request.priority,
          status: data.assignedToId ? 'ASSIGNED' : 'OPEN',
          assignedToId: data.assignedToId,
          plannedStartAt: data.plannedStartAt,
          plannedEndAt: data.plannedEndAt,
          failureReason: request.description,
          idempotencyKey: data.idempotencyKey,
          createdById: data.createdById,
        },
      });

      const updatedRequest = await tx.maintenanceRequest.update({
        where: { id: request.id },
        data: { status: 'CONVERTED_TO_WORK_ORDER' },
      });

      return { maintenanceRequest: updatedRequest, workOrder, wasCreated: true };
    });
  }

  private async updateMatching(
    organisationId: string,
    id: string,
    data: Prisma.MaintenanceRequestUncheckedUpdateInput,
  ): Promise<MaintenanceRequest | null> {
    const result = await this.prisma.maintenanceRequest.updateMany({
      where: { id, organisationId },
      data,
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.maintenanceRequest.findUniqueOrThrow({ where: { id } });
  }

  private async generateRequestCode(
    tx: Prisma.TransactionClient,
    organisationId: string,
  ): Promise<string> {
    let sequence = 1;
    let candidate = this.formatRequestCode(sequence);
    while (
      await tx.maintenanceRequest.findUnique({
        where: { organisationId_requestCode: { organisationId, requestCode: candidate } },
        select: { id: true },
      })
    ) {
      sequence += 1;
      candidate = this.formatRequestCode(sequence);
    }
    return candidate;
  }

  private formatRequestCode(sequence: number): string {
    return `${REQUEST_CODE_PREFIX}-${String(sequence).padStart(REQUEST_CODE_SEQUENCE_LENGTH, '0')}`;
  }
}
