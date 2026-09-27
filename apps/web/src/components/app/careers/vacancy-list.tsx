import type { PublicVacancySummary } from '@/app/careers/api';

import { VacancyCard } from './vacancy-card';

/**
 * Sprint 30.1 — Public Recruitment Experience & Candidate Application Flow.
 * Section 16 "Empty state": a currently-vacancy-less tenant still needs a
 * polished, reassuring careers page rather than a blank one.
 */
export function VacancyList({
  vacancies,
  organisationSlug,
}: {
  vacancies: PublicVacancySummary[];
  organisationSlug: string;
}) {
  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold tracking-tight">Open Positions</h2>
      {vacancies.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center">
          <p className="text-sm font-medium">No Open Positions</p>
          <p className="mt-1 text-sm text-muted-foreground">
            There are no open positions at the moment. Please check back later for new
            opportunities.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {vacancies.map((vacancy) => (
            <VacancyCard
              key={vacancy.publicSlug}
              vacancy={vacancy}
              organisationSlug={organisationSlug}
            />
          ))}
        </div>
      )}
    </section>
  );
}
