'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button } from '@zentuva/ui';

import { FinanceTabs } from '@/components/app/finance-tabs';
import { ApiError } from '@/lib/api-client';

import { listDecisionAnalyses } from '../api';
import {
  DECISION_ANALYSIS_STATUS_LABELS,
  DECISION_ANALYSIS_STATUS_VARIANT,
  DECISION_TYPE_LABELS,
} from '../labels';
import { DecisionAnalysisDialog } from './decision-analysis-dialog';

/**
 * Decision Analyses (Sprint 19, docs/domains/financial-decision-analysis.md)
 * — the MVP-closing management-decision layer over Sprints 13-18. Every
 * ROI/NPV/IRR/payback figure shown here (and on the detail page) is
 * computed live on read, never entered or stored.
 */
export default function DecisionAnalysesPage() {
  return (
    <Suspense fallback={null}>
      <DecisionAnalysesPageInner />
    </Suspense>
  );
}

function DecisionAnalysesPageInner() {
  const searchParams = useSearchParams();
  const prefillCapitalProjectId = searchParams.get('capitalProjectId') ?? undefined;
  const [createOpen, setCreateOpen] = useState(false);
  useEffect(() => {
    if (prefillCapitalProjectId) {
      setCreateOpen(true);
    }
  }, [prefillCapitalProjectId]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['decision-analyses'],
    queryFn: () => listDecisionAnalyses(),
  });
  const analyses = useMemo(() => data?.items ?? [], [data]);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Financial decision analyses — should we make this investment, and how should it be
            financed? Composes Financial Statements, Cashflow, Budget, Debt, and Capital Projects;
            never a second accounting engine, and approving a decision never posts a Journal Entry.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>New Decision Analysis</Button>
      </div>

      <FinanceTabs />

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Loading decision analyses…
        </p>
      )}
      {isError && (
        <p className="py-10 text-center text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load decision analyses.'}
        </p>
      )}
      {!isLoading && !isError && analyses.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No decision analyses yet — start one to evaluate an investment against Base, Optimistic,
          and Pessimistic scenarios.
        </p>
      )}

      {!isLoading && !isError && analyses.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Discount Rate</th>
                <th className="px-4 py-3 text-right font-medium">Analysis Period</th>
                <th className="px-4 py-3 text-right font-medium">Open</th>
              </tr>
            </thead>
            <tbody>
              {analyses.map((analysis) => (
                <tr key={analysis.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium">{analysis.name}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {DECISION_TYPE_LABELS[analysis.decisionType]}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={DECISION_ANALYSIS_STATUS_VARIANT[analysis.status]}>
                      {DECISION_ANALYSIS_STATUS_LABELS[analysis.status]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">{analysis.discountRatePercent}%</td>
                  <td className="px-4 py-3 text-right">{analysis.analysisPeriodMonths} mo</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/settings/finance/decisions/${analysis.id}`}
                      className="text-xs text-primary hover:underline"
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && (
        <DecisionAnalysisDialog
          defaultCapitalProjectId={prefillCapitalProjectId}
          onOpenChange={() => setCreateOpen(false)}
          onCreated={(id) => {
            setCreateOpen(false);
            refetch();
            window.location.assign(`/settings/finance/decisions/${id}`);
          }}
        />
      )}
    </main>
  );
}
