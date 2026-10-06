'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button } from '@zentuva/ui';

import { ApiError } from '@/lib/api-client';

import {
  activatePromotion,
  getPromotion,
  listGrants,
  pausePromotion,
  PromotionCondition,
  resumePromotion,
} from '../api';
import { PromotionDialog } from '../promotion-dialog';

const CONDITION_LABELS: Record<string, (c: PromotionCondition) => string> = {
  FIRST_QUALIFYING_ORDER: () => 'First qualifying order',
  MINIMUM_ORDER_VALUE: (c) => `Minimum order value ≥ ${c.minOrderValue}`,
  PRODUCT_QUANTITY: (c) => `Product quantity ≥ ${c.minQuantity}`,
  TERRITORY: () => 'Territory match',
};

/**
 * Sprint 40 — Promotion detail (docs/domains/d2c.md "Admin Experience"). Status/
 * validity/eligibility/benefit inspection, the activate/pause/resume lifecycle, an Edit
 * action (only reachable while `DRAFT` — the backend enforces this, this page simply
 * hides the action once it would always fail), and this promotion's own grant history.
 */
export default function PromotionDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);

  const {
    data: promotion,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['promotion', id],
    queryFn: () => getPromotion(id),
  });
  const { data: grantsData } = useQuery({
    queryKey: ['promotion-grants', id],
    queryFn: () => listGrants({ promotionId: id, pageSize: 20 }),
    enabled: !!promotion,
  });
  const grants = grantsData?.items ?? [];

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['promotion', id] });
    queryClient.invalidateQueries({ queryKey: ['promotions'] });
  }

  const activateMutation = useMutation({
    mutationFn: () => activatePromotion(id),
    onSuccess: invalidate,
  });
  const pauseMutation = useMutation({
    mutationFn: () => pausePromotion(id),
    onSuccess: invalidate,
  });
  const resumeMutation = useMutation({
    mutationFn: () => resumePromotion(id),
    onSuccess: invalidate,
  });

  const mutationError =
    activateMutation.error instanceof ApiError
      ? activateMutation.error.message
      : pauseMutation.error instanceof ApiError
        ? pauseMutation.error.message
        : resumeMutation.error instanceof ApiError
          ? resumeMutation.error.message
          : undefined;

  if (isLoading) {
    return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  }
  if (isError || !promotion) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Promotion not found.'}
        </p>
        <a href="/settings/d2c/promotions" className="mt-2 inline-block text-sm text-primary">
          ← Back to Promotions
        </a>
      </div>
    );
  }

  const benefit = promotion.benefits[0];

  return (
    <div className="space-y-6 p-6">
      <div>
        <a href="/settings/d2c/promotions" className="text-sm text-primary">
          ← Promotions
        </a>
        <div className="mt-2 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">{promotion.name}</h1>
          <div className="flex items-center gap-2">
            <Badge
              variant={
                promotion.status === 'ACTIVE'
                  ? 'success'
                  : promotion.status === 'PAUSED'
                    ? 'warning'
                    : 'default'
              }
            >
              {promotion.status}
            </Badge>
            {promotion.status === 'DRAFT' && (
              <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
                Edit
              </Button>
            )}
            {promotion.status === 'DRAFT' && (
              <Button
                size="sm"
                onClick={() => activateMutation.mutate()}
                disabled={activateMutation.isPending}
              >
                Activate
              </Button>
            )}
            {promotion.status === 'ACTIVE' && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => pauseMutation.mutate()}
                disabled={pauseMutation.isPending}
              >
                Pause
              </Button>
            )}
            {promotion.status === 'PAUSED' && (
              <Button
                size="sm"
                onClick={() => resumeMutation.mutate()}
                disabled={resumeMutation.isPending}
              >
                Resume
              </Button>
            )}
          </div>
        </div>
        {promotion.description && (
          <p className="mt-1 text-sm text-muted-foreground">{promotion.description}</p>
        )}
      </div>

      {mutationError && (
        <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{mutationError}</p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-border p-4">
          <h2 className="mb-3 text-sm font-semibold">Validity</h2>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Starts</dt>
              <dd>{new Date(promotion.startsAt).toLocaleString()}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Ends</dt>
              <dd>{new Date(promotion.endsAt).toLocaleString()}</dd>
            </div>
            {promotion.activatedAt && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Activated</dt>
                <dd>{new Date(promotion.activatedAt).toLocaleString()}</dd>
              </div>
            )}
          </dl>
        </section>

        <section className="rounded-lg border border-border p-4">
          <h2 className="mb-3 text-sm font-semibold">Benefit</h2>
          {benefit ? (
            <p className="text-sm">
              {benefit.type === 'BONUS_POINTS'
                ? `${benefit.pointsValue} bonus points`
                : `Free product × ${benefit.freeProductQuantity}`}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No benefit configured yet.</p>
          )}
        </section>

        <section className="rounded-lg border border-border p-4 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold">Eligibility Conditions</h2>
          {promotion.conditions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No conditions configured yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {promotion.conditions.map((condition) => (
                <li key={condition.id}>
                  {CONDITION_LABELS[condition.type]?.(condition) ?? condition.type}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-border p-4 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold">Grant History ({grants.length})</h2>
          {grants.length === 0 ? (
            <p className="text-sm text-muted-foreground">No consumer has qualified yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {grants.map((grant) => (
                <li key={grant.id} className="flex items-center justify-between">
                  <span>
                    {grant.consumer.fullName} · {grant.qualifyingSalesOrder.orderCode}
                  </span>
                  <span className="text-muted-foreground">
                    {grant.benefitTypeSnapshot === 'BONUS_POINTS'
                      ? `${grant.pointsAwardedSnapshot} points`
                      : `Free product × ${grant.freeProductQuantitySnapshot}`}{' '}
                    · {new Date(grant.grantedAt).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {editOpen && (
        <PromotionDialog
          promotion={promotion}
          onOpenChange={setEditOpen}
          onSaved={() => {
            setEditOpen(false);
            refetch();
          }}
        />
      )}
    </div>
  );
}
