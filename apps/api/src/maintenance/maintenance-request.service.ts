import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MaintenanceRequest, MaintenanceRequestStatus } from '@prisma/client';
import {
  ConvertMaintenanceRequestInput,
  CreateMaintenanceRequestInput,
  RejectMaintenanceRequestInput,
  UpdateMaintenanceRequestInput,
} from '@zentuva/validation';

import { AssetRepository } from '../assets/asset.repository';
import { MaintenanceTypeRepository } from './maintenance-type.repository';
import {
  ConvertMaintenanceRequestResult,
  CreateMaintenanceRequestResult,
  ListMaintenanceRequestsParams,
  MaintenanceRequestRepository,
} from './maintenance-request.repository';

const TERMINAL_STATUSES: MaintenanceRequestStatus[] = [
  'REJECTED',
  'CONVERTED_TO_WORK_ORDER',
  'CANCELLED',
];

/**
 * Domain service for `MaintenanceRequest` (Sprint 21, docs/domains/
 * maintenance.md). `OPEN`/`UNDER_REVIEW → APPROVED`/`REJECTED` is a soft-
 * idempotent transition (the established Sprint 17-19 convention);
 * `REJECTED`/`CONVERTED_TO_WORK_ORDER`/`CANCELLED` are hard-terminal — a
 * request that has already been rejected, converted, or cancelled cannot
 * be re-reviewed.
 */
@Injectable()
export class MaintenanceRequestService {
  constructor(
    private readonly maintenanceRequestRepository: MaintenanceRequestRepository,
    private readonly assetRepository: AssetRepository,
    private readonly maintenanceTypeRepository: MaintenanceTypeRepository,
  ) {}

  getById(organisationId: string, id: string): Promise<MaintenanceRequest> {
    return this.getByIdOrThrow(organisationId, id);
  }

  list(organisationId: string, params?: ListMaintenanceRequestsParams) {
    return this.maintenanceRequestRepository.findManyByOrganisation(organisationId, params);
  }

  async create(
    organisationId: string,
    input: CreateMaintenanceRequestInput,
    actorUserId: string,
  ): Promise<CreateMaintenanceRequestResult> {
    const asset = await this.assetRepository.findById(organisationId, input.assetId);
    if (!asset) {
      throw new BadRequestException('Asset not found');
    }
    return this.maintenanceRequestRepository.create({
      organisationId,
      assetId: input.assetId,
      title: input.title,
      description: input.description,
      priority: input.priority,
      issueType: input.issueType,
      requestedDueDate: input.requestedDueDate,
      notes: input.notes,
      idempotencyKey: input.idempotencyKey,
      createdById: actorUserId,
    });
  }

  async update(
    organisationId: string,
    id: string,
    input: UpdateMaintenanceRequestInput,
  ): Promise<MaintenanceRequest> {
    const request = await this.getByIdOrThrow(organisationId, id);
    this.assertNotTerminal(request);
    const updated = await this.maintenanceRequestRepository.update(organisationId, id, {
      title: input.title,
      description: input.description,
      priority: input.priority,
      issueType: input.issueType,
      requestedDueDate: input.requestedDueDate,
      notes: input.notes,
    });
    if (!updated) {
      throw new NotFoundException('Maintenance request not found');
    }
    return updated;
  }

  async approve(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<{ request: MaintenanceRequest; transitioned: boolean }> {
    return this.transition(organisationId, id, ['OPEN', 'UNDER_REVIEW'], 'APPROVED', {
      reviewedById: actorUserId,
      reviewedAt: new Date(),
    });
  }

  async reject(
    organisationId: string,
    id: string,
    input: RejectMaintenanceRequestInput,
    actorUserId: string,
  ): Promise<{ request: MaintenanceRequest; transitioned: boolean }> {
    return this.transition(organisationId, id, ['OPEN', 'UNDER_REVIEW'], 'REJECTED', {
      reviewedById: actorUserId,
      reviewedAt: new Date(),
      rejectionReason: input.rejectionReason,
    });
  }

  async cancel(
    organisationId: string,
    id: string,
  ): Promise<{ request: MaintenanceRequest; transitioned: boolean }> {
    return this.transition(
      organisationId,
      id,
      ['OPEN', 'UNDER_REVIEW', 'APPROVED'],
      'CANCELLED',
      {},
    );
  }

  async convert(
    organisationId: string,
    id: string,
    input: ConvertMaintenanceRequestInput,
    actorUserId: string,
  ): Promise<ConvertMaintenanceRequestResult> {
    const request = await this.getByIdOrThrow(organisationId, id);
    if (request.status !== 'APPROVED' && request.status !== 'CONVERTED_TO_WORK_ORDER') {
      throw new BadRequestException(
        `Cannot convert a ${request.status.toLowerCase()} request to a work order — it must be approved first`,
      );
    }
    const maintenanceType = await this.maintenanceTypeRepository.findById(
      organisationId,
      input.maintenanceTypeId,
    );
    if (!maintenanceType) {
      throw new BadRequestException('Maintenance type not found');
    }

    return this.maintenanceRequestRepository.convert({
      organisationId,
      requestId: id,
      maintenanceTypeId: input.maintenanceTypeId,
      plannedStartAt: input.plannedStartAt,
      plannedEndAt: input.plannedEndAt,
      assignedToId: input.assignedToId,
      idempotencyKey: input.idempotencyKey,
      createdById: actorUserId,
    });
  }

  private assertNotTerminal(request: MaintenanceRequest): void {
    if (TERMINAL_STATUSES.includes(request.status)) {
      throw new BadRequestException(
        `Cannot modify a ${request.status.toLowerCase()} request — its record is frozen`,
      );
    }
  }

  private async transition(
    organisationId: string,
    id: string,
    fromStatuses: MaintenanceRequestStatus[],
    toStatus: MaintenanceRequestStatus,
    extraData: Record<string, unknown>,
  ): Promise<{ request: MaintenanceRequest; transitioned: boolean }> {
    const request = await this.getByIdOrThrow(organisationId, id);

    if (TERMINAL_STATUSES.includes(request.status)) {
      throw new BadRequestException(
        `Cannot transition a ${request.status.toLowerCase()} request — it is a terminal state`,
      );
    }
    if (request.status === toStatus) {
      return { request, transitioned: false };
    }
    if (!fromStatuses.includes(request.status)) {
      throw new BadRequestException(
        `Cannot move a ${request.status.toLowerCase()} request to ${toStatus.toLowerCase()}`,
      );
    }

    const updated = await this.maintenanceRequestRepository.setStatus(organisationId, id, {
      status: toStatus,
      ...extraData,
    });
    if (!updated) {
      throw new NotFoundException('Maintenance request not found');
    }
    return { request: updated, transitioned: true };
  }

  private async getByIdOrThrow(organisationId: string, id: string): Promise<MaintenanceRequest> {
    const request = await this.maintenanceRequestRepository.findById(organisationId, id);
    if (!request) {
      throw new NotFoundException('Maintenance request not found');
    }
    return request;
  }
}
