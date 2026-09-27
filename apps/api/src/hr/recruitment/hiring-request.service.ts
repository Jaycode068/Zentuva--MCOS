import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { HiringRequest } from '@prisma/client';
import { CreateHiringRequestInput } from '@zentuva/validation';

import { DepartmentService } from '../department.service';
import { PositionService } from '../position.service';
import { CreateHiringRequestData, HiringRequestRepository } from './hiring-request.repository';

/**
 * Sprint 30 — Recruitment & Candidate Interview Management Foundation
 * (recruitment.md §"Hiring Request"). `approve()`/`reject()` are called from
 * TWO places by design (recruitment.md §"Workflow Integration" — "if
 * approval is required, reuse Workflow; keep Workflow and the recruitment
 * lifecycle separate"): directly, by an HR user, when an organisation has no
 * `HIRING_REQUEST_APPROVAL` `WorkflowDefinition` configured
 * (`hr.recruitment.hiring_request.approve`); and via
 * `HiringRequestWorkflowHandler`'s `onWorkflowApproved`/`onWorkflowExited`
 * callbacks when one is. Exactly one code path either way — this service
 * never knows or cares which trigger reached it.
 */
@Injectable()
export class HiringRequestService {
  constructor(
    private readonly hiringRequestRepository: HiringRequestRepository,
    private readonly departmentService: DepartmentService,
    private readonly positionService: PositionService,
  ) {}

  async getById(organisationId: string, id: string): Promise<HiringRequest> {
    const hiringRequest = await this.hiringRequestRepository.findById(organisationId, id);
    if (!hiringRequest) {
      throw new NotFoundException('Hiring request not found');
    }
    return hiringRequest;
  }

  getByIdWithRelations(organisationId: string, id: string) {
    return this.hiringRequestRepository.findByIdWithRelations(organisationId, id).then((hr) => {
      if (!hr) {
        throw new NotFoundException('Hiring request not found');
      }
      return hr;
    });
  }

  list(
    organisationId: string,
    params: { status?: HiringRequest['status']; departmentId?: string },
  ) {
    return this.hiringRequestRepository.list(organisationId, params);
  }

  async create(
    organisationId: string,
    input: CreateHiringRequestInput,
    requestedById: string,
  ): Promise<HiringRequest> {
    await this.departmentService.getById(organisationId, input.departmentId);
    await this.positionService.getById(organisationId, input.positionId);

    const data: CreateHiringRequestData = {
      organisationId,
      departmentId: input.departmentId,
      positionId: input.positionId,
      requestedHeadcount: input.requestedHeadcount,
      employmentType: input.employmentType,
      reason: input.reason,
      justification: input.justification,
      requestedStartDate: input.requestedStartDate,
      requestedById,
    };
    return this.hiringRequestRepository.create(data);
  }

  async submit(organisationId: string, id: string): Promise<{ transitioned: boolean }> {
    await this.getById(organisationId, id);
    const { transitioned } = await this.hiringRequestRepository.submit(organisationId, id);
    if (!transitioned) {
      throw new BadRequestException('Hiring request must be DRAFT to submit');
    }
    return { transitioned };
  }

  async approve(organisationId: string, id: string): Promise<{ transitioned: boolean }> {
    const { transitioned } = await this.hiringRequestRepository.approve(organisationId, id);
    return { transitioned };
  }

  async reject(organisationId: string, id: string): Promise<{ transitioned: boolean }> {
    const { transitioned } = await this.hiringRequestRepository.reject(organisationId, id);
    return { transitioned };
  }

  async revertToDraft(organisationId: string, id: string): Promise<void> {
    await this.hiringRequestRepository.revertToDraft(organisationId, id);
  }

  async cancel(organisationId: string, id: string): Promise<{ transitioned: boolean }> {
    await this.getById(organisationId, id);
    const { transitioned } = await this.hiringRequestRepository.cancel(organisationId, id);
    if (!transitioned) {
      throw new BadRequestException('Hiring request cannot be cancelled from its current status');
    }
    return { transitioned };
  }
}
