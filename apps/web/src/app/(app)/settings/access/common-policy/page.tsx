'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from '@zentuva/ui';

import { AccessTabs } from '@/components/app/access-tabs';
import { ApiError } from '@/lib/api-client';

import {
  CommonEmployeeAccessPolicy,
  getCommonAccessPolicy,
  updateCommonAccessPolicy,
} from '../api';
import { COMMON_ACCESS_CAPABILITY_LABELS } from '../labels';

const CAPABILITY_KEYS = Object.keys(
  COMMON_ACCESS_CAPABILITY_LABELS,
) as (keyof CommonEmployeeAccessPolicy)[];

/**
 * Common Employee Access (Sprint 25, docs/domains/access-control.md §6) — an
 * organisation-wide switch board for self-service capabilities. Disabling a capability
 * here removes it for every employee regardless of their individual role grants — this
 * is distinct from (and layered on top of) the `Employee Self-Service` role's own
 * permission grants.
 */
export default function CommonAccessPolicyPage() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['access-common-policy'],
    queryFn: () => getCommonAccessPolicy(),
  });

  const [local, setLocal] = useState<CommonEmployeeAccessPolicy | null>(null);
  useEffect(() => {
    if (data) setLocal(data);
  }, [data]);

  const mutation = useMutation({
    mutationFn: (policy: CommonEmployeeAccessPolicy) => updateCommonAccessPolicy(policy),
    onSuccess: () => refetch(),
  });

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Access Control</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Common Employee Access — organisation-wide toggles for self-service capabilities. This is
          separate from administrative HR access and module-specific operational access.
        </p>
      </div>

      <AccessTabs />

      {isLoading && <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>}
      {isError && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-destructive">
            {error instanceof ApiError ? error.message : 'Failed to load policy.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {local && (
        <div className="rounded-lg border border-border p-4">
          <div className="space-y-3">
            {CAPABILITY_KEYS.map((key) => (
              <label key={key} className="flex items-center justify-between gap-4 text-sm">
                <span>{COMMON_ACCESS_CAPABILITY_LABELS[key]}</span>
                <input
                  type="checkbox"
                  checked={local[key]}
                  onChange={(e) => setLocal({ ...local, [key]: e.target.checked })}
                />
              </label>
            ))}
          </div>

          {mutation.isError && (
            <p className="mt-3 text-sm text-destructive">
              {mutation.error instanceof ApiError ? mutation.error.message : 'Failed to save.'}
            </p>
          )}

          <div className="mt-6 flex justify-end">
            <Button disabled={mutation.isPending} onClick={() => local && mutation.mutate(local)}>
              {mutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}
