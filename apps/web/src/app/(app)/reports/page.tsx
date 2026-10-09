'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@zentuva/ui';

import { getCatalogue, type ReportDomain } from './api';
import { ReportError, ReportLoading } from '@/components/reporting/report-states';

const DOMAIN_LABELS: Record<ReportDomain, string> = {
  SALES: 'Sales',
  INVENTORY: 'Inventory',
  FINANCE: 'Finance',
  PRODUCTION: 'Production',
  HR: 'Workforce',
  OPERATIONS: 'Operations',
};

const DOMAIN_ORDER: ReportDomain[] = [
  'SALES',
  'INVENTORY',
  'FINANCE',
  'PRODUCTION',
  'HR',
  'OPERATIONS',
];

/**
 * Sprint 45 — Reporting & Business Intelligence Foundation (brief §15). The `/reports`
 * landing page — a concise overview and links into the reports this sprint
 * implemented, nothing more. Deliberately NOT the Sprint 46 Executive Dashboard: no
 * KPI cards here, no cross-domain aggregation, just what the brief itself asks for —
 * "a concise reporting overview... links to the reports implemented this sprint... a
 * short description of each... permission-aware visibility." The catalogue itself is
 * already filtered server-side to what this user can see (`ReportingService
 * .getCatalogue`) — this page never re-implements that filtering, and never shows a
 * report the user cannot open.
 */
export default function ReportsLandingPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['reporting-catalogue'],
    queryFn: getCatalogue,
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Reports</h1>
        <p className="text-sm text-muted-foreground">
          Business reports built on top of Zentuva&apos;s existing, authoritative data — every
          figure here comes from the same source the rest of the application already relies on;
          nothing is recalculated separately for reporting.
        </p>
      </div>

      {isLoading && <ReportLoading />}
      {isError && <ReportError message="Failed to load the reporting catalogue." />}

      {data && data.reports.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No reports are currently available to you. Contact an administrator if you believe this is
          incorrect.
        </p>
      )}

      {data &&
        DOMAIN_ORDER.filter((domain) =>
          data.reports.some((report) => report.domain === domain),
        ).map((domain) => (
          <section key={domain} className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground">{DOMAIN_LABELS[domain]}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {data.reports
                .filter((report) => report.domain === domain)
                .map((report) => (
                  <Link key={report.id} href={`/reports/${report.id}`}>
                    <Card className="h-full transition-colors hover:border-primary">
                      <CardHeader>
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-base">{report.displayName}</CardTitle>
                          {report.availability === 'BLOCKED_DATA_GAP' && (
                            <Badge variant="warning">Partial</Badge>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-muted-foreground">{report.description}</p>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
            </div>
          </section>
        ))}
    </div>
  );
}
