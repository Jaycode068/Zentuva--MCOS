'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Button, Input } from '@zentuva/ui';

import { FieldCard } from '@/components/field/FieldCard';
import { FieldStickyActionBar } from '@/components/field/FieldStickyActionBar';

import { listCustomers } from '../api';
import { CUSTOMER_TYPE_LABELS } from '../labels';

/** Customer search + card list (Sprint 4.8 brief §21) — no dense table, a prominent
 *  search box, and a sticky "New Customer" action always in reach. */
export default function FieldCustomersPage() {
  const [search, setSearch] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['customers', 'field', search],
    queryFn: () => listCustomers({ search: search || undefined }),
  });

  const customers = data?.items ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 p-4">
        <h1 className="text-xl font-semibold tracking-tight">Customers</h1>
        <Input
          placeholder="Search by name, code, or phone…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="h-12 text-base"
        />
      </div>

      <div className="flex-1 space-y-2 px-4 pb-4">
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && customers.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">No customers found.</p>
        )}
        {customers.map((customer) => (
          <FieldCard key={customer.id} href={`/field/customers/${customer.id}`}>
            <p className="font-medium">{customer.customerName}</p>
            <p className="text-xs text-muted-foreground">
              {CUSTOMER_TYPE_LABELS[customer.customerType]} · {customer.phoneNumber}
            </p>
          </FieldCard>
        ))}
      </div>

      <FieldStickyActionBar>
        <Link href="/field/customers/new" className="w-full">
          <Button size="touch" className="w-full">
            + New Customer
          </Button>
        </Link>
      </FieldStickyActionBar>
    </div>
  );
}
