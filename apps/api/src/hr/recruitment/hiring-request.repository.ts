import { Injectable } from '@nestjs/common';
import { HiringRequest, HiringRequestStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export interface CreateHiringRequestData {
  organisationId: string;
  departmentId: string;
  positionId: string;
  requestedHeadcount: number;
  employmentType: Prisma.HiringRequestCreateInput['employmentType'];
  reason: Prisma.HiringRequestCreateInput['reason'];
  justification?: string;
  requestedStartDate?: Date;
  requestedById: string;
}

export interface ListHiringRequestsParams {
  status?: HiringRequestStatus;
  departmentId?: string;
}

/**
 * Sprint 30 — Recruitment & Candidate Interview Management Foundation
 * (recruitment.md §"Hiring Request"). Thin Prisma access only — this
 * repository (specifically its `findById`/status-transition methods) is
 * exactly what `HiringRequestWorkflowHandler` (workflow/handlers/) injects,
 * exported by `RecruitmentModule` for that one-directional purpose, matching
 * `PurchaseOrderWorkflowHandler`'s own precedent exactly.
 */
@Injectable()
export class HiringRequestRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<HiringRequest | null> {
    return this.prisma.hiringRequest.findFirst({ where: { id, organisationId } });
  }

  findByIdWithRelations(organisationId: string, id: string) {
    return this.prisma.hiringRequest.findFirst({
      where: { id, organisationId },
      include: { department: true, position: true },
    });
  }

  list(organisationId: string, params: ListHiringRequestsParams = {}) {
    return this.prisma.hiringRequest.findMany({
      where: {
        organisationId,
        ...(params.status ? { status: params.status } : {}),
        ...(params.departmentId ? { departmentId: params.departmentId } : {}),
      },
      include: { department: true, position: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  create(data: CreateHiringRequestData): Promise<HiringRequest> {
    return this.prisma.hiringRequest.create({ data });
  }

  /** Conditional `updateMany` (never a blind `update`) — every status transition below
   *  reuses this so a cross-tenant id or an unexpected current status structurally
   *  cannot match, matching this codebase's established idiom throughout. */
  private async transition(
    organisationId: string,
    id: string,
    fromStatuses: HiringRequestStatus[],
    data: Prisma.HiringRequestUpdateInput,
  ): Promise<{ transitioned: boolean; hiringRequest: HiringRequest | null }> {
    const result = await this.prisma.hiringRequest.updateMany({
      where: { id, organisationId, status: { in: fromStatuses } },
      data,
    });
    const hiringRequest = await this.findById(organisationId, id);
    return { transitioned: result.count > 0, hiringRequest };
  }

  submit(organisationId: string, id: string) {
    return this.transition(organisationId, id, ['DRAFT'], { status: 'SUBMITTED' });
  }

  approve(organisationId: string, id: string) {
    return this.transition(organisationId, id, ['SUBMITTED'], { status: 'APPROVED' });
  }

  reject(organisationId: string, id: string) {
    return this.transition(organisationId, id, ['SUBMITTED'], { status: 'REJECTED' });
  }

  /** Reverts a request back to `DRAFT` when its `WorkflowInstance` exits without
   *  approval (return/cancel) — mirrors `PurchaseOrderWorkflowHandler.onWorkflowExited`'s
   *  own "never clobber a status it never actually changed" guard: only a currently
   *  `SUBMITTED` request is reverted. */
  revertToDraft(organisationId: string, id: string) {
    return this.transition(organisationId, id, ['SUBMITTED'], { status: 'DRAFT' });
  }

  cancel(organisationId: string, id: string) {
    return this.transition(organisationId, id, ['DRAFT', 'SUBMITTED'], { status: 'CANCELLED' });
  }
}
