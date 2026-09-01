'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button } from '@zentuva/ui';

import { FinanceTabs } from '@/components/app/finance-tabs';
import { ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format-currency';

import { getCapitalProjectSpending, listCapitalProjects, type CapitalProject } from '../api';
import {
  CAPITAL_PROJECT_CATEGORY_LABELS,
  CAPITAL_PROJECT_STATUS_LABELS,
  CAPITAL_PROJECT_STATUS_VARIANT,
} from '../labels';
import { CapitalProjectDialog } from './capital-project-dialog';

/**
 * Capital Projects (Sprint 18, docs/domains/investment-projects.md) — the
 * management layer over Sprints 13-17. A project's Planned Cost/Funding/
 * Committed/Actual figures are always server-computed, never entered or
 * stored directly.
 */
export default function CapitalProjectsPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['capital-projects'],
    queryFn: () => listCapitalProjects(),
  });
  const projects = useMemo(() => data?.items ?? [], [data]);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Capital projects and investments — a management layer over Budgeting, Debt, and
            Cashflow. Planning a project never posts a Journal Entry.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>Add Capital Project</Button>
      </div>

      <FinanceTabs />

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading capital projects…</p>
      )}
      {isError && (
        <p className="py-10 text-center text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load capital projects.'}
        </p>
      )}
      {!isLoading && !isError && projects.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No capital projects yet — add one to plan a machine purchase, factory expansion, or other
          significant investment.
        </p>
      )}

      {!isLoading && !isError && projects.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Project</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Planned Cost</th>
                <th className="px-4 py-3 text-right font-medium">Funding Gap</th>
                <th className="px-4 py-3 text-right font-medium">Actual Cost</th>
                <th className="px-4 py-3 font-medium">Completion</th>
                <th className="px-4 py-3 text-right font-medium">Open</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <ProjectRow key={project.id} project={project} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && (
        <CapitalProjectDialog
          onOpenChange={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            refetch();
          }}
        />
      )}
    </main>
  );
}

function ProjectRow({ project }: { project: CapitalProject }) {
  const { data: financials } = useQuery({
    queryKey: ['capital-project-spending', project.id],
    queryFn: () => getCapitalProjectSpending(project.id),
  });

  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-3">
        <div className="font-medium">{project.name}</div>
        <div className="font-mono text-xs text-muted-foreground">{project.projectCode}</div>
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">
        {CAPITAL_PROJECT_CATEGORY_LABELS[project.category]}
      </td>
      <td className="px-4 py-3">
        <Badge variant={CAPITAL_PROJECT_STATUS_VARIANT[project.status]}>
          {CAPITAL_PROJECT_STATUS_LABELS[project.status]}
        </Badge>
      </td>
      <td className="px-4 py-3 text-right">
        {financials ? formatCurrency(financials.plannedCost, project.currency) : '—'}
      </td>
      <td className="px-4 py-3 text-right">
        {financials ? formatCurrency(financials.fundingGap, project.currency) : '—'}
      </td>
      <td className="px-4 py-3 text-right">
        {financials ? formatCurrency(financials.actualCost, project.currency) : '—'}
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">
        {new Date(project.plannedCompletionDate).toLocaleDateString()}
      </td>
      <td className="px-4 py-3 text-right">
        <Link
          href={`/settings/finance/capital-projects/${project.id}`}
          className="text-xs text-primary hover:underline"
        >
          Open
        </Link>
      </td>
    </tr>
  );
}
