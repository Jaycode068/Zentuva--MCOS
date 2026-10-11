'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

import { ApiError } from '@/lib/api-client';

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            refetchOnWindowFocus: false,
            /**
             * Sprint 46 — found via live verification of the new dashboard pages: a
             * restricted user hitting a correctly-enforced `403` (e.g. a Member
             * without `finance.reports.view` loading the Finance Dashboard) was
             * stuck on "Loading…" for several seconds while TanStack Query's
             * DEFAULT behaviour (retry any failure 3x with exponential backoff)
             * silently re-sent the same request that can never succeed — the exact
             * same "don't let retry logic hammer a call that can never succeed"
             * problem this codebase's own webhook controllers already guard
             * against. A `4xx` response is never transient (no retry count fixes a
             * permission or validation error); only network failures and `5xx`
             * responses are worth retrying. Pre-existing default, not previously
             * set explicitly — this is a genuine, global bug fix, not Sprint
             * 46-specific behaviour.
             */
            retry: (failureCount, error) => {
              if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
                return false;
              }
              return failureCount < 3;
            },
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
