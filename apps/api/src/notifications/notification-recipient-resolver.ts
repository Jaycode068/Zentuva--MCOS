import { Injectable } from '@nestjs/common';
import { WorkflowEvent, WorkflowInstance, WorkflowStepInstance } from '@prisma/client';

import { WorkflowDefinitionService } from '../workflow/workflow-definition.service';
import { WorkflowEligibilityService } from '../workflow/workflow-eligibility.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Sprint 27 §Workstream 4 "Recipient Resolution" (docs/domains/notifications.md §7).
 * Answers "who should be told about this `WorkflowEvent`" — one method per event
 * type, each returning a plain list of `User.id`s. Deliberately reuses
 * `WorkflowEligibilityService.listEligibleApprovers` (imported from `WorkflowModule`,
 * not reimplemented) for every "which approvers can act on this step" question — the
 * brief's own "the user eligible to approve a step is not necessarily the requester,
 * model these separately" is exactly what keeps these two recipient sources
 * (`listEligibleApprovers` vs. `instance.requestedById`) distinct below.
 *
 * Never notifies "every organisation user" — every branch returns either a specific,
 * individually-identified user id, or the output of the same eligibility engine
 * Workflow itself uses to decide who may act.
 */
@Injectable()
export class NotificationRecipientResolver {
  constructor(
    private readonly workflowEligibilityService: WorkflowEligibilityService,
    private readonly workflowDefinitionService: WorkflowDefinitionService,
    private readonly prisma: PrismaService,
  ) {}

  async resolve(
    event: WorkflowEvent,
    instance: WorkflowInstance,
    stepInstances: WorkflowStepInstance[],
  ): Promise<string[]> {
    switch (event.eventType) {
      case 'APPROVAL_REQUIRED':
        return this.eligibleApproversForStep(event, instance, stepInstances);

      case 'STEP_APPROVED': {
        // Sprint 27 §7 — mid-chain approval notifies the requester ("step N
        // approved, moving on"); the FINAL step's approval is covered by the
        // separate APPROVED event instead, avoiding a double notification for the
        // same click (both events share one correlationId, workflow.md §7).
        const step = stepInstances.find((s) => s.id === event.workflowStepInstanceId);
        const hasNextStep = step && stepInstances.some((s) => s.sequence === step.sequence + 1);
        return hasNextStep ? [instance.requestedById] : [];
      }

      case 'APPROVED':
      case 'REJECTED':
      case 'RETURNED':
        return [instance.requestedById];

      case 'RESUBMITTED': {
        // Notify whoever RETURNED the previous instance — "the correction you asked
        // for has come back" — a distinct recipient from APPROVAL_REQUIRED's step-1
        // approvers (who also fire for this same resubmit() call, but for the new
        // instance's own step 1, not the returner of the old one).
        if (!instance.previousInstanceId) return [];
        const returnDecision = await this.prisma.workflowDecision.findFirst({
          where: { workflowInstanceId: instance.previousInstanceId, decision: 'RETURN' },
          orderBy: { createdAt: 'desc' },
        });
        return returnDecision ? [returnDecision.actorUserId] : [];
      }

      case 'CANCELLED':
        // Skip notifying the requester about their OWN cancel action.
        return event.actorUserId && event.actorUserId !== instance.requestedById
          ? [instance.requestedById]
          : [];

      case 'EXPIRED': {
        const recipients = new Set<string>([instance.requestedById]);
        const activeStep = stepInstances.find((s) => s.status === 'ACTIVE');
        if (activeStep) {
          const approvers = await this.eligibleApproversForStep(
            event,
            instance,
            stepInstances,
            activeStep,
          );
          approvers.forEach((id) => recipients.add(id));
        }
        return [...recipients];
      }

      default:
        // SUBMITTED (redundant with APPROVAL_REQUIRED) and any other event type
        // with no defined notification mapping — deliberately zero recipients, not
        // an error. See notifications.md §3 "Excluded event types."
        return [];
    }
  }

  private async eligibleApproversForStep(
    event: WorkflowEvent,
    instance: WorkflowInstance,
    stepInstances: WorkflowStepInstance[],
    stepOverride?: WorkflowStepInstance,
  ): Promise<string[]> {
    const step = stepOverride ?? stepInstances.find((s) => s.id === event.workflowStepInstanceId);
    if (!step) return [];

    const definition = await this.workflowDefinitionService.getById(
      instance.organisationId,
      instance.workflowDefinitionId,
    );
    const eligible = await this.workflowEligibilityService.listEligibleApprovers({
      organisationId: instance.organisationId,
      requiredPermission: step.requiredPermissionSnapshot,
      requiredScope: step.requiredScopeSnapshot,
      assignedUserId: step.assignedUserIdSnapshot,
      requestedById: instance.requestedById,
      allowSelfApproval: definition?.allowSelfApproval ?? false,
    });
    return eligible.map((u) => u.userId);
  }
}
