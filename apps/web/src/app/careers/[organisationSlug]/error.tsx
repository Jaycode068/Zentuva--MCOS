'use client';

import { Button } from '@zentuva/ui';

import { PublicCareersLayout } from '@/components/app/careers/careers-layout';

/**
 * Sprint 30.1 — Public Recruitment Experience & Candidate Application Flow
 * (recruitment.md §"Loading, Empty and Error States"). Catches real failures
 * (network/5xx) as distinct from a 404 (`not-found.tsx` handles that) —
 * never surfaces the raw error message/stack to a public candidate.
 */
export default function CareersError({ reset }: { reset: () => void }) {
  return (
    <PublicCareersLayout>
      <div className="py-16 text-center">
        <h1 className="text-xl font-semibold">Something Went Wrong</h1>
        <p className="mx-auto mt-3 max-w-sm text-sm text-muted-foreground">
          We couldn&apos;t load this page right now. Please try again in a moment.
        </p>
        <Button variant="outline" size="sm" className="mt-5" onClick={() => reset()}>
          Try Again
        </Button>
      </div>
    </PublicCareersLayout>
  );
}
