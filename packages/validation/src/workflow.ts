import { z } from 'zod';

import { accessScopeSchema } from './access-control';

/**
 * Sprint 26 — Workflow & Approval Foundation (docs/domains/workflow.md). Following the
 * exact `access-control.ts` one-shared-file-per-domain convention: one Zod schema per
 * write endpoint, server always injects `organisationId`/actor ids, never trusts them
 * from the body. Reuses `accessScopeSchema` rather than redefining the `AccessScope`
 * enum a second time.
 */

export const workflowStepInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  code: z.string().trim().min(1).max(60),
  sequence: z.coerce.number().int().min(1),
  requiredPermission: z.string().trim().min(1),
  requiredScope: accessScopeSchema.optional(),
  assignedUserId: z.string().trim().min(1).nullable().optional(),
});
export type WorkflowStepInput = z.infer<typeof workflowStepInputSchema>;

export const createWorkflowDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  code: z.string().trim().min(1).max(60),
  description: z.string().trim().max(1000).optional(),
  subjectType: z.string().trim().min(1).max(60),
  allowSelfApproval: z.boolean().optional(),
  steps: z.array(workflowStepInputSchema).min(1, 'At least one step is required'),
});
export type CreateWorkflowDefinitionInput = z.infer<typeof createWorkflowDefinitionSchema>;

export const updateWorkflowDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  allowSelfApproval: z.boolean().optional(),
  steps: z.array(workflowStepInputSchema).min(1, 'At least one step is required').optional(),
});
export type UpdateWorkflowDefinitionInput = z.infer<typeof updateWorkflowDefinitionSchema>;

export const createWorkflowInstanceSchema = z.object({
  workflowDefinitionCode: z.string().trim().min(1),
  subjectType: z.string().trim().min(1),
  subjectId: z.string().trim().min(1),
  /// Sprint 26.1 §9 — optional; the server never invents a due date, and an absent
  /// `dueAt` never counts as overdue.
  dueAt: z.coerce.date().optional(),
});
export type CreateWorkflowInstanceInput = z.infer<typeof createWorkflowInstanceSchema>;

/** Approve/cancel: a comment is a courtesy, never mandatory. */
export const workflowDecisionInputSchema = z.object({
  comment: z.string().trim().max(2000).optional(),
});
export type WorkflowDecisionInput = z.infer<typeof workflowDecisionInputSchema>;

/** Reject/return: Sprint 26.1 §2 "Return comment rules" — a comment explaining why is
 *  mandatory, not optional, for both. Enforced here AND, defensively, again in
 *  `WorkflowInstanceService` itself (server-authoritative — never trust only the
 *  validation-pipe layer for a business rule). */
export const workflowRequiredCommentInputSchema = z.object({
  comment: z.string().trim().min(1, 'A comment is required').max(2000),
});
export type WorkflowRequiredCommentInput = z.infer<typeof workflowRequiredCommentInputSchema>;
