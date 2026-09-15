import { Injectable } from '@nestjs/common';
import { AccessScope } from '@prisma/client';

import { EffectiveAccessResolver } from '../identity/authorization/effective-access-resolver';
import { ScopeEvaluator } from '../identity/authorization/scope-evaluator';
import { UserService } from '../identity/user/user.service';

export interface StepEligibilityInput {
  organisationId: string;
  requiredPermission: string;
  requiredScope: AccessScope | null;
  assignedUserId: string | null;
  requestedById: string;
  allowSelfApproval: boolean;
  candidateUserId: string;
}

export interface EligibilityResult {
  eligible: boolean;
  /** Present only when `eligible` is `false` — never shown as raw text to an
   *  unauthorized caller (workflow.md §14 "don't leak internals"), but always logged
   *  and available for the caller's own "why can't I approve this" UI state. */
  reason?: string;
}

/**
 * Sprint 26 — Workflow & Approval Foundation (docs/domains/workflow.md §6 "Approval
 * eligibility"). The single place that answers "is this specific User allowed to act on
 * this specific step, right now" — reused by `WorkflowInstanceService.approve/reject/
 * return`, the My Approvals list filter, and `GET /workflows/instances/:id/eligible-
 * approvers`.
 *
 * Deliberately thin: every actual authorization decision is delegated to
 * `EffectiveAccessResolver`/`ScopeEvaluator` (Sprint 25) — this service adds no new
 * authorization primitive, only workflow-specific composition (self-approval policy,
 * explicit-assignment narrowing, live re-evaluation rather than a cached list).
 *
 * Important honesty note (workflow.md §6): `requiredScope`, when set, only checks that
 * the candidate holds `requiredPermission` granted AT that scope (via
 * `ScopeEvaluator.hasScope`) — it does NOT additionally verify the specific business
 * record actually falls within that scope (e.g. that an `OWN_TEAM`-scoped approver's
 * team actually includes whoever raised this particular Purchase Order). The existing
 * data model has no department/team relationship on a Purchase Order to check that
 * against, so this service does not pretend to. `ORGANISATION` scope has no such gap —
 * it is unconditionally satisfied. See workflow.md §6 "Known limitation" for the full
 * writeup.
 */
@Injectable()
export class WorkflowEligibilityService {
  constructor(
    private readonly effectiveAccessResolver: EffectiveAccessResolver,
    private readonly scopeEvaluator: ScopeEvaluator,
    private readonly userService: UserService,
  ) {}

  async checkStepEligibility(input: StepEligibilityInput): Promise<EligibilityResult> {
    if (!input.allowSelfApproval && input.candidateUserId === input.requestedById) {
      return { eligible: false, reason: 'The requester cannot approve their own request' };
    }

    if (input.assignedUserId && input.assignedUserId !== input.candidateUserId) {
      return { eligible: false, reason: 'This step is assigned to a specific approver' };
    }

    const access = await this.effectiveAccessResolver.resolve(
      input.organisationId,
      input.candidateUserId,
    );
    if (!access.userIsActive) {
      return { eligible: false, reason: 'User is not active' };
    }

    const hasPermission = input.requiredScope
      ? this.scopeEvaluator.hasScope(access, input.requiredPermission, input.requiredScope)
      : this.scopeEvaluator.hasAny(access, input.requiredPermission);
    if (!hasPermission) {
      return {
        eligible: false,
        reason: input.requiredScope
          ? `Missing "${input.requiredPermission}" at scope ${input.requiredScope}`
          : `Missing "${input.requiredPermission}"`,
      };
    }

    return { eligible: true };
  }

  /** Used by `GET /workflows/instances/:id/eligible-approvers` and the My Approvals
   *  filter: given a specific step, is this ONE candidate eligible — never a scan of
   *  every organisation User (there is no server-side "list every user who holds
   *  permission X" primitive, and building one is out of scope for this sprint's
   *  eligibility check; see workflow.md §6's deferred-capabilities note). */
  async isEligibleCandidate(input: StepEligibilityInput): Promise<boolean> {
    const result = await this.checkStepEligibility(input);
    return result.eligible;
  }

  /** `GET /workflows/instances/:id/eligible-approvers`. There is no server-side "list
   *  every user who holds permission X" index in `EffectiveAccessResolver` — it only
   *  resolves access FOR a given user, never in reverse — so this fetches every
   *  organisation User once and re-evaluates `checkStepEligibility` per candidate.
   *  Fine for this sprint's scale (an organisation's user list, not a
   *  cross-organisation search); a real reverse-index is a documented future
   *  optimization if this ever needs to scale past a few hundred users. */
  async listEligibleApprovers(
    input: Omit<StepEligibilityInput, 'candidateUserId'>,
  ): Promise<{ userId: string; firstName: string; lastName: string; email: string }[]> {
    const users = await this.userService.listWithRoles(input.organisationId);
    const eligible: { userId: string; firstName: string; lastName: string; email: string }[] = [];
    for (const user of users) {
      if (user.status !== 'ACTIVE') continue;
      const result = await this.checkStepEligibility({ ...input, candidateUserId: user.id });
      if (result.eligible) {
        eligible.push({
          userId: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
        });
      }
    }
    return eligible;
  }
}
