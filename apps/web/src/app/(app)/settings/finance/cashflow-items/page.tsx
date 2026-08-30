'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@zentuva/ui';

import { FinanceTabs } from '@/components/app/finance-tabs';
import { ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format-currency';

import {
  activateCashflowForecastItem,
  deactivateCashflowForecastItem,
  getCashflowSettings,
  listCashflowForecastItems,
  type CashflowForecastItem,
} from '../api';
import {
  CASHFLOW_DIRECTION_LABELS,
  CASHFLOW_ITEM_STATUS_LABELS,
  CASHFLOW_ITEM_STATUS_VARIANT,
  CASHFLOW_RECURRENCE_LABELS,
  CASHFLOW_SOURCE_TYPE_LABELS,
} from '../labels';
import { CashflowItemDialog } from './cashflow-item-dialog';
import { CashflowSettingsDialog } from './cashflow-settings-dialog';

/**
 * Cashflow Items (Sprint 15, docs/domains/cashflow.md §5/§6) — every
 * management-entered future cash commitment (one-time or recurring), plus the
 * Cashflow Settings (minimum reserve, default delay days) that shape the
 * forecast's own baseline assumptions.
 */
export default function CashflowItemsPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const { data: settings } = useQuery({
    queryKey: ['cashflow-settings'],
    queryFn: () => getCashflowSettings(),
  });

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['cashflow-items'],
    queryFn: () => listCashflowForecastItems(),
  });
  const items = useMemo(() => data?.items ?? [], [data]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['cashflow-items'] });
    queryClient.invalidateQueries({ queryKey: ['cashflow-forecast'] });
  };
  const invalidateSettings = () => {
    queryClient.invalidateQueries({ queryKey: ['cashflow-settings'] });
    queryClient.invalidateQueries({ queryKey: ['cashflow-forecast'] });
  };

  const toggleStatus = async (item: CashflowForecastItem) => {
    if (item.status === 'ACTIVE') {
      await deactivateCashflowForecastItem(item.id);
    } else {
      await activateCashflowForecastItem(item.id);
    }
    invalidate();
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Future cash commitments the accounting records don&apos;t already capture — rent,
            planned payments, and management&apos;s own collection estimates.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>Add Cashflow Item</Button>
      </div>

      <FinanceTabs />

      {settings && (
        <Card className="mb-8">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Cashflow Settings
            </CardTitle>
            <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
              Edit
            </Button>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">Minimum Cash Reserve</p>
              <p className="text-lg font-semibold">
                {formatCurrency(settings.minimumCashReserve, 'NGN')}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Default Collection Delay</p>
              <p className="text-lg font-semibold">{settings.defaultCollectionDelayDays} days</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Default Payment Delay</p>
              <p className="text-lg font-semibold">{settings.defaultPaymentDelayDays} days</p>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading cashflow items…</p>
      )}
      {isError && (
        <p className="py-10 text-center text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load cashflow items.'}
        </p>
      )}
      {!isLoading && !isError && items.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No cashflow items yet — add a known commitment like rent or a planned payment.
        </p>
      )}

      {!isLoading && !isError && items.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Description</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Source</th>
                <th className="px-4 py-3 font-medium">Recurrence</th>
                <th className="px-4 py-3 font-medium">Next Date</th>
                <th className="px-4 py-3 text-right font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">{item.description}</td>
                  <td className="px-4 py-3">
                    <Badge variant={item.direction === 'INFLOW' ? 'success' : 'default'}>
                      {CASHFLOW_DIRECTION_LABELS[item.direction]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {CASHFLOW_SOURCE_TYPE_LABELS[item.sourceType]}
                  </td>
                  <td className="px-4 py-3">{CASHFLOW_RECURRENCE_LABELS[item.recurrence]}</td>
                  <td className="px-4 py-3">{new Date(item.expectedDate).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-right font-medium">
                    {formatCurrency(item.amount, item.currency)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={CASHFLOW_ITEM_STATUS_VARIANT[item.status]}>
                      {CASHFLOW_ITEM_STATUS_LABELS[item.status]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => toggleStatus(item)}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      {item.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && (
        <CashflowItemDialog onOpenChange={() => setCreateOpen(false)} onCreated={invalidate} />
      )}
      {settingsOpen && settings && (
        <CashflowSettingsDialog
          settings={settings}
          onOpenChange={() => setSettingsOpen(false)}
          onSaved={invalidateSettings}
        />
      )}
    </main>
  );
}
