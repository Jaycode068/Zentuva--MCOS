import { orgInitialsFor } from '@/lib/org-initials';
import type { PublicOrganisationInfo } from '@/app/careers/api';

/**
 * Sprint 30.1 — Public Recruitment Experience & Candidate Application Flow.
 * Tenant-aware careers landing hero — every field is dynamically supplied by
 * that tenant's own organisation profile (recruitment.md §"Public Careers
 * Page"). Never hardcodes an organisation name/industry/location. Falls back
 * to the same initials-avatar convention `WorkspaceHeader` already
 * established when no logo has been uploaded.
 */
export function CareersHero({ organisation }: { organisation: PublicOrganisationInfo }) {
  const locationLine = [
    organisation.industry,
    [organisation.city, organisation.country].filter(Boolean).join(', '),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <header className="mb-10 flex flex-col items-center gap-5 text-center">
      {organisation.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- tenant-uploaded URL
        <img
          src={organisation.logoUrl}
          alt=""
          className="h-16 w-16 rounded-xl border border-border object-contain"
        />
      ) : (
        <div
          className="flex h-16 w-16 items-center justify-center rounded-xl bg-primary text-lg font-semibold text-primary-foreground"
          aria-hidden="true"
        >
          {orgInitialsFor(organisation.name)}
        </div>
      )}

      <div>
        <p className="text-sm font-medium uppercase tracking-wide text-primary">Careers</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
          Join the {organisation.name} Team
        </h1>
        {locationLine && <p className="mt-2 text-sm text-muted-foreground">{locationLine}</p>}
        <p className="mx-auto mt-4 max-w-xl text-sm text-muted-foreground sm:text-base">
          {organisation.description ??
            `Build your career with ${organisation.name}. Explore our current opportunities and apply today.`}
        </p>
      </div>
    </header>
  );
}
