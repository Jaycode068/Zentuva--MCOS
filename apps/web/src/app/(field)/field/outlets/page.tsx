'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Button, Input } from '@zentuva/ui';

import { FieldCard } from '@/components/field/FieldCard';
import { FieldStickyActionBar } from '@/components/field/FieldStickyActionBar';

import { listOutlets } from '../api';
import { OUTLET_TYPE_LABELS } from '../labels';

/** Outlet search + card list — mirrors the Customers list exactly (Sprint 4.8 brief §3). */
export default function FieldOutletsPage() {
  const [search, setSearch] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['outlets', 'field', search],
    queryFn: () => listOutlets({ search: search || undefined }),
  });

  const outlets = data?.items ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 p-4">
        <h1 className="text-xl font-semibold tracking-tight">Outlets</h1>
        <Input
          placeholder="Search by name or code…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="h-12 text-base"
        />
      </div>

      <div className="flex-1 space-y-2 px-4 pb-4">
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && outlets.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">No outlets found.</p>
        )}
        {outlets.map((outlet) => (
          <FieldCard key={outlet.id} href={`/field/outlets/${outlet.id}`}>
            <p className="font-medium">{outlet.name}</p>
            <p className="text-xs text-muted-foreground">
              {OUTLET_TYPE_LABELS[outlet.outletType]} · {outlet.customer.customerName}
            </p>
          </FieldCard>
        ))}
      </div>

      <FieldStickyActionBar>
        <Link href="/field/outlets/new" className="w-full">
          <Button size="touch" className="w-full">
            + New Outlet
          </Button>
        </Link>
      </FieldStickyActionBar>
    </div>
  );
}
