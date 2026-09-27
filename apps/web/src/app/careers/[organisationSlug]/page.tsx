import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ApiError } from '@/lib/api-client';
import { CareersHero } from '@/components/app/careers/careers-hero';
import { VacancyList } from '@/components/app/careers/vacancy-list';
import { PublicCareersLayout } from '@/components/app/careers/careers-layout';

import { getOrganisationCareers } from '../api';

/**
 * Sprint 30.1 — Public Recruitment Experience & Candidate Application Flow
 * (recruitment.md §"Public Careers Page"). A Server Component — the entire
 * tenant-aware careers template renders server-side: no client loading
 * spinner (`loading.tsx` covers the fetch instead), correct HTTP 404 for an
 * unknown/inactive organisation slug (`notFound()`), and real per-tenant
 * `generateMetadata` below. `force-dynamic` because a vacancy being
 * published/closed by HR must be reflected immediately — this route is never
 * statically cached.
 */
export const dynamic = 'force-dynamic';

type Params = { organisationSlug: string };

async function loadCareersData(organisationSlug: string) {
  try {
    return await getOrganisationCareers(organisationSlug);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }
    throw error;
  }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  try {
    const { organisation } = await getOrganisationCareers(params.organisationSlug);
    return {
      title: `${organisation.name} Careers`,
      description:
        organisation.description ??
        `Explore current job openings at ${organisation.name} and apply online.`,
    };
  } catch {
    return { title: 'Careers' };
  }
}

export default async function CareersOrganisationPage({ params }: { params: Params }) {
  const { organisation, vacancies } = await loadCareersData(params.organisationSlug);

  return (
    <PublicCareersLayout>
      <CareersHero organisation={organisation} />
      <VacancyList vacancies={vacancies} organisationSlug={params.organisationSlug} />
    </PublicCareersLayout>
  );
}
