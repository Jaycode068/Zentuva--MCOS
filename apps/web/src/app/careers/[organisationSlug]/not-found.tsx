import { PublicCareersLayout } from '@/components/app/careers/careers-layout';

/**
 * Sprint 30.1 — Public Recruitment Experience & Candidate Application Flow
 * (recruitment.md §"Published Vacancy Rules"). Covers `notFound()` calls
 * from this segment AND its nested vacancy/apply routes — an unknown
 * organisation slug, an unpublished/closed/cancelled/expired vacancy, or a
 * direct hit on a vacancy that never existed all land here with a real HTTP
 * 404 and no internal HR status ever mentioned.
 */
export default function CareersNotFound() {
  return (
    <PublicCareersLayout>
      <div className="py-16 text-center">
        <h1 className="text-xl font-semibold">Page Not Found</h1>
        <p className="mx-auto mt-3 max-w-sm text-sm text-muted-foreground">
          This careers page or position is no longer available. It may have been closed, or the link
          may be incorrect.
        </p>
      </div>
    </PublicCareersLayout>
  );
}
