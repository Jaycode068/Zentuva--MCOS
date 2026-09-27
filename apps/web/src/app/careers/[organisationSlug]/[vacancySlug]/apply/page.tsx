import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ApiError } from '@/lib/api-client';
import { PublicCareersLayout } from '@/components/app/careers/careers-layout';
import { ApplicationForm } from '@/components/app/careers/application-form';

import { getOrganisationCareers, getPublicVacancy } from '../../../api';

/**
 * Sprint 30.1 — Public Recruitment Experience & Candidate Application Flow
 * (recruitment.md §"Candidate Application Experience"). Server Component
 * wrapper only — resolves the tenant + vacancy once (also giving this route
 * the same 404-on-unavailable-vacancy protection as the detail page, so a
 * candidate cannot reach the application form for a closed/expired vacancy
 * by guessing the `/apply` URL directly) and hands both to the interactive
 * `ApplicationForm` client component. `force-dynamic` for the same reason as
 * the other two public routes.
 */
export const dynamic = 'force-dynamic';

type Params = { organisationSlug: string; vacancySlug: string };

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  try {
    const [vacancy, { organisation }] = await Promise.all([
      getPublicVacancy(params.organisationSlug, params.vacancySlug),
      getOrganisationCareers(params.organisationSlug),
    ]);
    return { title: `Apply — ${vacancy.title} — ${organisation.name}` };
  } catch {
    return { title: 'Apply' };
  }
}

export default async function ApplyPage({ params }: { params: Params }) {
  let vacancy;
  let organisationName: string;
  try {
    const [vacancyResult, careers] = await Promise.all([
      getPublicVacancy(params.organisationSlug, params.vacancySlug),
      getOrganisationCareers(params.organisationSlug),
    ]);
    vacancy = vacancyResult;
    organisationName = careers.organisation.name;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }
    throw error;
  }

  return (
    <PublicCareersLayout>
      <ApplicationForm
        vacancy={vacancy}
        organisationName={organisationName}
        organisationSlug={params.organisationSlug}
        vacancySlug={params.vacancySlug}
      />
    </PublicCareersLayout>
  );
}
