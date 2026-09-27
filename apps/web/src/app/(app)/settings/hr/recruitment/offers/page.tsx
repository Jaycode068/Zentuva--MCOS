'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button } from '@zentuva/ui';

import { HrTabs } from '@/components/app/hr-tabs';
import { ApiError } from '@/lib/api-client';

import { OfferStatus, listOffers } from '../api';
import { OFFER_STATUS_LABELS, OFFER_STATUS_VARIANT } from '../labels';

export default function OffersPage() {
  const [statusFilter, setStatusFilter] = useState<'' | OfferStatus>('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['recruitment-offers', statusFilter],
    queryFn: () => listOffers({ status: statusFilter || undefined }),
  });

  const offers = data ?? [];

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Human Resources</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Offers — track candidate offers end to end.
        </p>
      </div>

      <HrTabs />

      <div className="mb-4 flex flex-wrap gap-2">
        {(['', 'DRAFT', 'ISSUED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN'] as const).map(
          (status) => (
            <Button
              key={status || 'all'}
              size="sm"
              variant={statusFilter === status ? 'default' : 'outline'}
              onClick={() => setStatusFilter(status)}
            >
              {status ? OFFER_STATUS_LABELS[status] : 'All'}
            </Button>
          ),
        )}
      </div>

      {isLoading && <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>}
      {isError && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-destructive">
            {error instanceof ApiError ? error.message : 'Failed to load offers.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && (
        <div className="space-y-3">
          {offers.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No offers match this filter.
            </p>
          )}
          {offers.map((offer) => (
            <a
              key={offer.id}
              href={`/settings/hr/recruitment/applications/${offer.applicationId}`}
              className="block rounded-lg border border-border p-4 hover:bg-secondary/50"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  {offer.application?.candidate.firstName} {offer.application?.candidate.lastName}
                </span>
                <Badge variant={OFFER_STATUS_VARIANT[offer.status]}>
                  {OFFER_STATUS_LABELS[offer.status]}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {offer.application?.vacancy.title}
                {offer.proposedSalary ? ` · ₦${offer.proposedSalary.toLocaleString()}` : ''}
              </p>
            </a>
          ))}
        </div>
      )}
    </main>
  );
}
