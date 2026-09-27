import { Injectable } from '@nestjs/common';

import { HiringRequestRepository } from '../../hr/recruitment/hiring-request.repository';
import {
  WorkflowSubjectHandler,
  WorkflowSubjectValidationResult,
} from '../workflow-subject-handler';

/** The stable `WorkflowDefinition.subjectType`/`code` every Hiring Request
 *  approval workflow definition must use — recruitment.md §"Workflow
 *  Integration". */
export const HIRING_REQUEST_SUBJECT_TYPE = 'HIRING_REQUEST';

/**
 * Sprint 30's one Workflow integration (recruitment.md §"Workflow
 * Integration") — the exact `PurchaseOrderWorkflowHandler` recipe (Sprint 26),
 * injecting only the already-exported `HiringRequestRepository`, never
 * `HiringRequestService`/`RecruitmentModule`'s controllers.
 *
 * Approval routing is OPTIONAL per the brief ("if approval is required,
 * reuse Workflow"): a `HiringRequest` may also be moved `DRAFT → SUBMITTED →
 * APPROVED/REJECTED` directly by an HR user via
 * `HiringRequestService.submit()`/`.approve()`/`.reject()`
 * (`hr.recruitment.hiring_request.manage`/`.approve`) when an organisation has
 * no `HIRING_REQUEST_APPROVAL` `WorkflowDefinition` configured. Both paths
 * converge on the SAME `HiringRequestRepository` transition methods — this
 * handler and the direct HR action are two different TRIGGERS for one
 * transition, never two competing state machines.
 *
 * `validateForSubmission` accepts either `DRAFT` or already-`SUBMITTED` (unlike
 * Purchase Order's DRAFT-only gate) — a hiring request may be routed into an
 * approval workflow either freshly, or after already being moved to
 * `SUBMITTED` directly through Recruitment's own endpoint; either way,
 * `onWorkflowSubmitted` performs the identical `DRAFT/SUBMITTED → SUBMITTED`
 * transition (a no-op if already `SUBMITTED`, via the same conditional
 * `updateMany` every transition in this codebase uses — never an error).
 */
@Injectable()
export class HiringRequestWorkflowHandler implements WorkflowSubjectHandler {
  readonly subjectType = HIRING_REQUEST_SUBJECT_TYPE;

  constructor(private readonly hiringRequestRepository: HiringRequestRepository) {}

  async describe(organisationId: string, subjectId: string): Promise<string | null> {
    const hiringRequest = await this.hiringRequestRepository.findByIdWithRelations(
      organisationId,
      subjectId,
    );
    if (!hiringRequest) {
      return null;
    }
    return `Hiring Request — ${hiringRequest.position.title} (${hiringRequest.department.name})`;
  }

  async validateForSubmission(
    organisationId: string,
    subjectId: string,
  ): Promise<WorkflowSubjectValidationResult> {
    const hiringRequest = await this.hiringRequestRepository.findById(organisationId, subjectId);
    if (!hiringRequest) {
      return { ok: false, reason: 'Hiring request not found' };
    }
    if (hiringRequest.status !== 'DRAFT' && hiringRequest.status !== 'SUBMITTED') {
      return {
        ok: false,
        reason: `Hiring request must be DRAFT or SUBMITTED to route for approval (currently ${hiringRequest.status})`,
      };
    }
    return { ok: true };
  }

  // `_actorUserId` unused — kept to match `WorkflowSubjectHandler`'s full signature,
  // same reasoning as `PurchaseOrderWorkflowHandler`'s own unused-parameter comment.
  async onWorkflowSubmitted(
    organisationId: string,
    subjectId: string,
    _actorUserId: string,
  ): Promise<void> {
    await this.hiringRequestRepository.submit(organisationId, subjectId);
  }

  async onWorkflowApproved(
    organisationId: string,
    subjectId: string,
    _finalApproverId: string,
  ): Promise<void> {
    await this.hiringRequestRepository.approve(organisationId, subjectId);
  }

  async onWorkflowExited(
    organisationId: string,
    subjectId: string,
    _actorUserId: string,
  ): Promise<void> {
    const hiringRequest = await this.hiringRequestRepository.findById(organisationId, subjectId);
    // A request that never left DRAFT (e.g. its WorkflowInstance was cancelled
    // before submit) has nothing to revert — same guard
    // `PurchaseOrderWorkflowHandler.onWorkflowExited` uses.
    if (hiringRequest && hiringRequest.status === 'SUBMITTED') {
      await this.hiringRequestRepository.revertToDraft(organisationId, subjectId);
    }
  }
}
