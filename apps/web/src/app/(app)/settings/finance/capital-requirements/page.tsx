'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button } from '@zentuva/ui';

import { FinanceTabs } from '@/components/app/finance-tabs';
import { ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format-currency';

import {
  approveCapitalRequirement,
  cancelCapitalRequirement,
  completeCapitalRequirement,
  fundCapitalRequirement,
  getCapitalRequirementBudgetCoverage,
  listCapitalRequirements,
  proposeCapitalRequirement,
  type CapitalRequirement,
} from '../api';
import {
  CAPITAL_REQUIREMENT_PRIORITY_LABELS,
  CAPITAL_REQUIREMENT_PRIORITY_VARIANT,
  CAPITAL_REQUIREMENT_STATUS_LABELS,
  CAPITAL_REQUIREMENT_STATUS_VARIANT,
  CAPITAL_REQUIREMENT_TYPE_LABELS,
} from '../labels';
import { CapitalRequirementDialog } from './capital-requirement-dialog';

/**
 * Capital Requirements (Sprint 17, docs/domains/debt-management.md §3) — the
 * structured business reason for financing, distinct from any approved
 * `DebtFacility`. Lifecycle: DRAFT → PROPOSED → APPROVED → FUNDED →
 * COMPLETED, plus CANCELLED — every transition is an explicit action, never
 * automatic.
 */
export default function CapitalRequirementsPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['capital-requirements'],
    queryFn: () => listCapitalRequirements(),
  });
  const requirements = useMemo(() => data?.items ?? [], [data]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['capital-requirements'] });
  };

  const transition = useMutation({
    mutationFn: ({
      id,
      action,
    }: {
      id: string;
      action: 'propose' | 'approve' | 'fund' | 'complete' | 'cancel';
    }) => {
      if (action === 'propose') return proposeCapitalRequirement(id);
      if (action === 'approve') return approveCapitalRequirement(id);
      if (action === 'fund') return fundCapitalRequirement(id);
      if (action === 'complete') return completeCapitalRequirement(id);
      return cancelCapitalRequirement(id);
    },
    onSuccess: invalidate,
  });

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The business case for financing — a Capital Requirement is not yet an approved loan.
            Optionally linked to a Budget/CAPEX line for a live Budget Coverage %.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>Add Capital Requirement</Button>
      </div>

      <FinanceTabs />

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Loading capital requirements…
        </p>
      )}
      {isError && (
        <p className="py-10 text-center text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load capital requirements.'}
        </p>
      )}
      {!isLoading && !isError && requirements.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No capital requirements yet — add one to capture why financing is needed before a facility
          is created.
        </p>
      )}

      {!isLoading && !isError && requirements.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Priority</th>
                <th className="px-4 py-3 text-right font-medium">Required Amount</th>
                <th className="px-4 py-3 font-medium">Budget Coverage</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {requirements.map((requirement) => (
                <RequirementRow
                  key={requirement.id}
                  requirement={requirement}
                  onTransition={(action) => transition.mutate({ id: requirement.id, action })}
                  pending={transition.isPending}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {transition.isError && (
        <p className="mt-4 text-sm text-destructive">
          {transition.error instanceof ApiError
            ? transition.error.message
            : 'Failed to update capital requirement.'}
        </p>
      )}

      {createOpen && (
        <CapitalRequirementDialog
          onOpenChange={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            invalidate();
          }}
        />
      )}
    </main>
  );
}

function RequirementRow({
  requirement,
  onTransition,
  pending,
}: {
  requirement: CapitalRequirement;
  onTransition: (action: 'propose' | 'approve' | 'fund' | 'complete' | 'cancel') => void;
  pending: boolean;
}) {
  const { data: coverage } = useQuery({
    queryKey: ['capital-requirement-budget-coverage', requirement.id],
    queryFn: () => getCapitalRequirementBudgetCoverage(requirement.id),
    enabled: !!requirement.budgetId,
  });

  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-3 font-medium">{requirement.title}</td>
      <td className="px-4 py-3 text-xs text-muted-foreground">
        {CAPITAL_REQUIREMENT_TYPE_LABELS[requirement.type]}
      </td>
      <td className="px-4 py-3">
        <Badge variant={CAPITAL_REQUIREMENT_PRIORITY_VARIANT[requirement.priority]}>
          {CAPITAL_REQUIREMENT_PRIORITY_LABELS[requirement.priority]}
        </Badge>
      </td>
      <td className="px-4 py-3 text-right">{formatCurrency(requirement.requiredAmount, 'NGN')}</td>
      <td className="px-4 py-3 text-xs text-muted-foreground">
        {!requirement.budgetId
          ? '—'
          : coverage
            ? coverage.coveragePercent === null
              ? '—'
              : `${coverage.coveragePercent.toFixed(1)}% (${formatCurrency(coverage.budgetedAmount, 'NGN')})`
            : 'Loading…'}
      </td>
      <td className="px-4 py-3">
        <Badge variant={CAPITAL_REQUIREMENT_STATUS_VARIANT[requirement.status]}>
          {CAPITAL_REQUIREMENT_STATUS_LABELS[requirement.status]}
        </Badge>
      </td>
      <td className="px-4 py-3 text-right space-x-3">
        {requirement.status === 'DRAFT' && (
          <button
            type="button"
            disabled={pending}
            onClick={() => onTransition('propose')}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Propose
          </button>
        )}
        {requirement.status === 'PROPOSED' && (
          <button
            type="button"
            disabled={pending}
            onClick={() => onTransition('approve')}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Approve
          </button>
        )}
        {requirement.status === 'APPROVED' && (
          <button
            type="button"
            disabled={pending}
            onClick={() => onTransition('fund')}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Mark Funded
          </button>
        )}
        {requirement.status === 'FUNDED' && (
          <button
            type="button"
            disabled={pending}
            onClick={() => onTransition('complete')}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Complete
          </button>
        )}
        {requirement.status !== 'COMPLETED' && requirement.status !== 'CANCELLED' && (
          <button
            type="button"
            disabled={pending}
            onClick={() => onTransition('cancel')}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
        )}
      </td>
    </tr>
  );
}
