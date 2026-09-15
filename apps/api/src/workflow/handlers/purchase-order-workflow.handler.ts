import { Injectable } from '@nestjs/common';
import { PurchaseOrderStatus } from '@prisma/client';

import { PurchaseOrderRepository } from '../../procurement/purchase-order/purchase-order.repository';
import {
  WorkflowSubjectHandler,
  WorkflowSubjectValidationResult,
} from '../workflow-subject-handler';

/** The stable `WorkflowDefinition.subjectType`/`code` every Purchase Order approval
 *  workflow definition must use — see docs/domains/workflow.md §8. */
export const PURCHASE_ORDER_SUBJECT_TYPE = 'PURCHASE_ORDER';

/**
 * Sprint 26's one domain integration (docs/domains/workflow.md §8 "Recommended Purchase
 * Order integration"). Deliberately reuses the EXISTING `PurchaseOrderStatus` enum with
 * no schema change: `DRAFT` was already the only submittable state, `PENDING` and
 * `APPROVED` were already reserved slots (`approvedById` existed since Sprint 4.3,
 * documented "Always null in this sprint — no approval workflow exists yet") that no
 * endpoint had ever actually reached. This handler is the first thing that ever
 * populates them.
 *
 * Honest scope note: the pre-existing generic `PATCH /procurement/purchase-orders/:id`
 * already allows directly setting `status: "PENDING"` (Sprint 4.3's
 * `updatePurchaseOrderSchema`, unrelated to Workflow) — this sprint deliberately does
 * NOT tighten that endpoint to funnel `PENDING` exclusively through Workflow, per the
 * brief's own "do not force an unsafe lifecycle rewrite" allowance (§8). Workflow adds
 * a genuinely new, governed path to `APPROVED` (previously unreachable by any means);
 * it does not yet make `PENDING` exclusively workflow-gated. See workflow.md §8's full
 * writeup for the reasoning and the natural low-risk follow-up this leaves open.
 *
 * Reject/Return/Cancel all map to the identical domain-side effect (`PENDING` →
 * `DRAFT`) — `PurchaseOrder` has no separate "rejected" status of its own, and adding
 * one is out of scope for this sprint (workflow.md §8). The distinction between *why*
 * the PO came back lives entirely in the `WorkflowDecision` audit trail.
 */
@Injectable()
export class PurchaseOrderWorkflowHandler implements WorkflowSubjectHandler {
  readonly subjectType = PURCHASE_ORDER_SUBJECT_TYPE;

  constructor(private readonly purchaseOrderRepository: PurchaseOrderRepository) {}

  async describe(organisationId: string, subjectId: string): Promise<string | null> {
    const po = await this.purchaseOrderRepository.findById(organisationId, subjectId);
    return po?.purchaseOrderNumber ?? null;
  }

  async validateForSubmission(
    organisationId: string,
    subjectId: string,
  ): Promise<WorkflowSubjectValidationResult> {
    const po = await this.purchaseOrderRepository.findById(organisationId, subjectId);
    if (!po) {
      return { ok: false, reason: 'Purchase order not found' };
    }
    if (po.status !== PurchaseOrderStatus.DRAFT) {
      return {
        ok: false,
        reason: `Purchase order must be DRAFT to submit for approval (currently ${po.status})`,
      };
    }
    return { ok: true };
  }

  // `_actorUserId` unused — kept to match `WorkflowSubjectHandler`'s full signature;
  // this handler's PENDING transition doesn't need to know who submitted it, only the
  // audit trail (WorkflowDecision) does.
  async onWorkflowSubmitted(
    organisationId: string,
    subjectId: string,
    _actorUserId: string,
  ): Promise<void> {
    await this.purchaseOrderRepository.update(organisationId, subjectId, {
      status: PurchaseOrderStatus.PENDING,
    });
  }

  async onWorkflowApproved(
    organisationId: string,
    subjectId: string,
    finalApproverId: string,
  ): Promise<void> {
    await this.purchaseOrderRepository.update(organisationId, subjectId, {
      status: PurchaseOrderStatus.APPROVED,
      approvedById: finalApproverId,
    });
  }

  // `_actorUserId` unused — same reasoning as `onWorkflowSubmitted` above.
  async onWorkflowExited(
    organisationId: string,
    subjectId: string,
    _actorUserId: string,
  ): Promise<void> {
    const po = await this.purchaseOrderRepository.findById(organisationId, subjectId);
    // A PO that never left DRAFT (e.g. its WorkflowInstance was cancelled before
    // submit) has nothing to revert — guards against clobbering a status the handler
    // never actually changed.
    if (po && po.status === PurchaseOrderStatus.PENDING) {
      await this.purchaseOrderRepository.update(organisationId, subjectId, {
        status: PurchaseOrderStatus.DRAFT,
      });
    }
  }
}
