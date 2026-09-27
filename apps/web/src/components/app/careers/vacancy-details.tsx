import { buttonVariants } from '@zentuva/ui';

import type { PublicVacancyDetail } from '@/app/careers/api';

function formatEnum(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Sprint 30.1 — Public Recruitment Experience & Candidate Application Flow.
 * Full public vacancy detail page content (recruitment.md §"Public Vacancy
 * Details"). Every section here maps 1:1 to a field the backend's
 * hand-built `PublicVacancyDetail` allowlist already exposes — nothing
 * internal (screening notes, interviewer identities, HR decisions) can leak
 * through this component because it was never given that data to begin with.
 */
export function VacancyDetails({
  vacancy,
  organisationSlug,
  vacancySlug,
}: {
  vacancy: PublicVacancyDetail;
  organisationSlug: string;
  vacancySlug: string;
}) {
  const salaryRange =
    vacancy.salaryMin != null || vacancy.salaryMax != null
      ? [vacancy.salaryMin, vacancy.salaryMax].filter((v) => v != null).join(' – ')
      : null;

  return (
    <article>
      <a
        href={`/careers/${organisationSlug}`}
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← All Open Positions
      </a>

      <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">{vacancy.title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {vacancy.departmentName ? `${vacancy.departmentName} · ` : ''}
        {formatEnum(vacancy.employmentType)} · {formatEnum(vacancy.workArrangement)}
        {vacancy.location ? ` · ${vacancy.location}` : ''}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-muted-foreground sm:grid-cols-3">
        {salaryRange && (
          <div>
            <dt className="text-xs uppercase tracking-wide">Salary</dt>
            <dd>{salaryRange}</dd>
          </div>
        )}
        <div>
          <dt className="text-xs uppercase tracking-wide">Openings</dt>
          <dd>{vacancy.numberOfOpenings}</dd>
        </div>
        {vacancy.applicationDeadline && (
          <div>
            <dt className="text-xs uppercase tracking-wide">Apply By</dt>
            <dd>{new Date(vacancy.applicationDeadline).toLocaleDateString()}</dd>
          </div>
        )}
      </dl>

      <a
        href={`/careers/${organisationSlug}/${vacancySlug}/apply`}
        className={buttonVariants({ size: 'touch', className: 'mt-6 w-full sm:w-auto' })}
      >
        Apply for this Position
      </a>

      <div className="mt-10 space-y-8">
        <section>
          <h2 className="mb-2 text-lg font-medium">About the Role</h2>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
            {vacancy.description}
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-medium">Responsibilities</h2>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
            {vacancy.responsibilities}
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-medium">Requirements</h2>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
            {vacancy.requirements}
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-medium">Qualifications</h2>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
            {vacancy.qualifications}
          </p>
        </section>

        {vacancy.experienceRequirements && (
          <section>
            <h2 className="mb-2 text-lg font-medium">Experience</h2>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
              {vacancy.experienceRequirements}
            </p>
          </section>
        )}
      </div>

      <a
        href={`/careers/${organisationSlug}/${vacancySlug}/apply`}
        className={buttonVariants({ size: 'touch', className: 'mt-10 w-full sm:w-auto' })}
      >
        Apply for this Position
      </a>
    </article>
  );
}
