'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Dialog, DialogHeader, DialogTitle, Textarea } from '@zentuva/ui';

import { WorkflowTabs } from '@/components/app/workflow-tabs';
import { ApiError } from '@/lib/api-client';

import {
  approveWorkflowInstance,
  listMyApprovals,
  MyApprovalItem,
  rejectWorkflowInstance,
  returnWorkflowInstance,
} from '../api';

type DecisionKind = 'approve' | 'reject' | 'return';

/**
 * My Approvals (Sprint 26, docs/domains/workflow.md §9). The backend
 * (`WorkflowInstanceService.listMyApprovals`) does the real filtering — every item
 * rendered here has already been eligibility-checked server-side; this page never
 * hides an ineligible action behind a disabled button, because ineligible items are
 * never present in the response at all.
 */
export default function MyApprovalsPage() {
  const [decisionTarget, setDecisionTarget] = useState<{
    item: MyApprovalItem;
    kind: DecisionKind;
  } | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['workflow-my-approvals'],
    queryFn: () => listMyApprovals(),
  });

  const items = data?.items ?? [];

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Workflow &amp; Approval</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          My Approvals — workflow steps you are personally eligible to act on right now.
        </p>
      </div>

      <WorkflowTabs />

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading your approvals…</p>
      )}
      {isError && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-destructive">
            {error instanceof ApiError ? error.message : 'Failed to load your approvals.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && (
        <div className="space-y-3">
          {items.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nothing is currently waiting on your approval.
            </p>
          )}
          {items.map((item) => (
            <div key={item.id} className="rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">
                    {item.workflowInstance.subjectType} — {item.workflowInstance.subjectId}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Step: {item.stepNameSnapshot} · Requested by{' '}
                    <span className="font-mono">{item.workflowInstance.requestedById}</span>
                  </p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {item.requiredPermissionSnapshot}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setDecisionTarget({ item, kind: 'approve' })}>
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setDecisionTarget({ item, kind: 'return' })}
                  >
                    Return
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setDecisionTarget({ item, kind: 'reject' })}
                  >
                    Reject
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      window.location.href = `/settings/workflows/instances/${item.workflowInstanceId}`;
                    }}
                  >
                    View
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {decisionTarget && (
        <DecisionDialog target={decisionTarget} onClose={() => setDecisionTarget(null)} />
      )}
    </main>
  );
}

const DECISION_LABELS: Record<DecisionKind, string> = {
  approve: 'Approve',
  reject: 'Reject',
  return: 'Return for Correction',
};

/** Sprint 26.1 §2 "Return comment rules" — reject/return require a non-empty
 *  comment; approve's remains optional. Enforced server-side too
 *  (`workflowRequiredCommentInputSchema` + `WorkflowInstanceService.exitWorkflow`) —
 *  this client-side check only avoids a round trip for the obvious case. */
const COMMENT_REQUIRED: Record<DecisionKind, boolean> = {
  approve: false,
  reject: true,
  return: true,
};

function DecisionDialog({
  target,
  onClose,
}: {
  target: { item: MyApprovalItem; kind: DecisionKind };
  onClose: () => void;
}) {
  const [comment, setComment] = useState('');
  const [touched, setTouched] = useState(false);
  const queryClient = useQueryClient();

  const commentRequired = COMMENT_REQUIRED[target.kind];
  const commentMissing = commentRequired && !comment.trim();

  const mutation = useMutation({
    mutationFn: () => {
      const id = target.item.workflowInstanceId;
      if (target.kind === 'approve') return approveWorkflowInstance(id, comment || undefined);
      if (target.kind === 'reject') return rejectWorkflowInstance(id, comment);
      return returnWorkflowInstance(id, comment);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-my-approvals'] });
      onClose();
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogHeader>
        <DialogTitle>{DECISION_LABELS[target.kind]}</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setTouched(true);
          if (commentMissing) return;
          mutation.mutate();
        }}
      >
        <p className="text-sm text-muted-foreground">
          {target.item.workflowInstance.subjectType} — {target.item.workflowInstance.subjectId} ·{' '}
          {target.item.stepNameSnapshot}
        </p>
        <div>
          <Textarea
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder={commentRequired ? 'Comment (required)' : 'Optional comment'}
          />
          {touched && commentMissing && (
            <p className="mt-1 text-xs text-destructive">
              A comment is required to {target.kind === 'reject' ? 'reject' : 'return'} this
              request.
            </p>
          )}
        </div>
        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError ? mutation.error.message : 'Action failed.'}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant={target.kind === 'reject' ? 'destructive' : 'default'}
            disabled={mutation.isPending || (touched && commentMissing)}
          >
            {mutation.isPending ? 'Submitting…' : DECISION_LABELS[target.kind]}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
