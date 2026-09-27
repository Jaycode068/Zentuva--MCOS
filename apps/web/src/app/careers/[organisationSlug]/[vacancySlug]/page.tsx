import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ApiError } from '@/lib/api-client';
import { PublicCareersLayout } from '@/components/app/careers/careers-layout';
import { VacancyDetails } from '@/components/app/careers/vacancy-details';

import { getOrganisationCareers, getPublicVacancy } from '../../api';

/**
 * Sprint 30.1 — Public Recruitment Experience & Candidate Application Flow
 * (recruitment.md §"Published Vacancy Rules" / §"Vacancy Details Page").
 * Server Component — a direct URL to an unpublished/closed/cancelled/expired
 * vacancy 404s here exactly the same way an unknown one does, because
 * `CareersService.getPublicVacancy` already enforces the visibility rule
 * server-side (never merely hidden by the frontend). `force-dynamic` for the
 * same reason as the landing page.
 */
export const dynamic = 'force-dynamic';

type Params = { organisationSlug: string; vacancySlug: string };

async function loadVacancy(params: Params) {
  try {
    return await getPublicVacancy(params.organisationSlug, params.vacancySlug);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }
    throw error;
  }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  try {
    const [vacancy, { organisation }] = await Promise.all([
      getPublicVacancy(params.organisationSlug, params.vacancySlug),
      getOrganisationCareers(params.organisationSlug),
    ]);
    return {
      title: `${vacancy.title} — ${organisation.name}`,
      description: vacancy.description.slice(0, 160),
    };
  } catch {
    return { title: 'Vacancy' };
  }
}

export default async function PublicVacancyPage({ params }: { params: Params }) {
  const vacancy = await loadVacancy(params);

  return (
    <PublicCareersLayout>
      <VacancyDetails
        vacancy={vacancy}
        organisationSlug={params.organisationSlug}
        vacancySlug={params.vacancySlug}
      />
    </PublicCareersLayout>
  );
}
