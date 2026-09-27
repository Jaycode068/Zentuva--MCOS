'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@zentuva/ui';

import { HrTabs } from '@/components/app/hr-tabs';

import { listApplications, listOffers, listVacancies } from './api';

/**
 * Sprint 30 — Recruitment & Candidate Interview Management Foundation
 * (recruitment.md §"Recruitment Dashboard"). Deliberately a lightweight,
 * client-composed view over the existing list endpoints — no dedicated
 * dashboard/reporting endpoint, per the brief's own "do not turn this into
 * Operational Reporting" instruction.
 */
export default function RecruitmentDashboardPage() {
  const { data: vacancies = [] } = useQuery({
    queryKey: ['recruitment-vacancies', 'all'],
    queryFn: () => listVacancies(),
  });
  const { data: applications = [] } = useQuery({
    queryKey: ['recruitment-applications', 'all'],
    queryFn: () => listApplications(),
  });
  const { data: offers = [] } = useQuery({
    queryKey: ['recruitment-offers', 'all'],
    queryFn: () => listOffers(),
  });

  const openVacancies = vacancies.filter((v) => v.status === 'PUBLISHED').length;
  const inScreening = applications.filter((a) => a.status === 'SCREENING').length;
  const interviewing = applications.filter((a) => a.status === 'INTERVIEWING').length;
  const activeOffers = offers.filter((o) => o.status === 'ISSUED' || o.status === 'DRAFT').length;
  const hired = applications.filter((a) => a.status === 'SELECTED').length;

  const activityByVacancy = new Map<string, { title: string; count: number }>();
  for (const application of applications) {
    const title = application.vacancy?.title ?? 'Unknown vacancy';
    const existing = activityByVacancy.get(application.vacancyId);
    activityByVacancy.set(application.vacancyId, {
      title,
      count: (existing?.count ?? 0) + 1,
    });
  }
  const recentActivity = [...activityByVacancy.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const stats = [
    { label: 'Open Vacancies', value: openVacancies },
    { label: 'Applications', value: applications.length },
    { label: 'In Screening', value: inScreening },
    { label: 'Interviewing', value: interviewing },
    { label: 'Offers', value: activeOffers },
    { label: 'Hired', value: hired },
  ];

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Human Resources</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Recruitment overview — vacancies, applications, and hiring progress.
        </p>
      </div>

      <HrTabs />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="pt-6">
              <p className="text-2xl font-semibold">{stat.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{stat.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Recent Activity by Vacancy</CardTitle>
        </CardHeader>
        <CardContent>
          {recentActivity.length === 0 ? (
            <p className="text-sm text-muted-foreground">No applications yet.</p>
          ) : (
            <ul className="space-y-2">
              {recentActivity.map((item) => (
                <li key={item.title} className="flex items-center justify-between text-sm">
                  <span>{item.title}</span>
                  <span className="text-muted-foreground">{item.count} applications</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="mt-6 flex flex-wrap gap-3">
        <a
          href="/settings/hr/recruitment/hiring-requests"
          className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-secondary"
        >
          Hiring Requests
        </a>
        <a
          href="/settings/hr/recruitment/vacancies"
          className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-secondary"
        >
          Vacancies
        </a>
        <a
          href="/settings/hr/recruitment/offers"
          className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-secondary"
        >
          Offers
        </a>
      </div>
    </main>
  );
}
