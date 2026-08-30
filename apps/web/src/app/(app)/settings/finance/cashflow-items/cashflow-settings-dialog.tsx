'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button, Dialog, DialogFooter, DialogHeader, DialogTitle, Input, Label } from '@zentuva/ui';

import { ApiError } from '@/lib/api-client';

import { updateCashflowSettings, type CashflowSettings } from '../api';

/**
 * "Cashflow Settings" dialog (Sprint 15, docs/domains/cashflow.md §9/§10) — the
 * minimum cash reserve is a management-defined safety threshold, never a claim
 * about insolvency; the default collection/payment delay days are the fallback
 * assumption used when neither a scenario nor a per-invoice adjustment applies.
 */
export function CashflowSettingsDialog({
  settings,
  onOpenChange,
  onSaved,
}: {
  settings: CashflowSettings;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [minimumCashReserve, setMinimumCashReserve] = useState(settings.minimumCashReserve);
  const [defaultCollectionDelayDays, setDefaultCollectionDelayDays] = useState(
    settings.defaultCollectionDelayDays,
  );
  const [defaultPaymentDelayDays, setDefaultPaymentDelayDays] = useState(
    settings.defaultPaymentDelayDays,
  );

  const mutation = useMutation({
    mutationFn: () =>
      updateCashflowSettings({
        minimumCashReserve,
        defaultCollectionDelayDays,
        defaultPaymentDelayDays,
      }),
    onSuccess: onSaved,
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Cashflow Settings</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="space-y-1.5">
          <Label>Minimum Cash Reserve</Label>
          <Input
            type="number"
            step="any"
            min="0"
            value={minimumCashReserve}
            onChange={(event) => setMinimumCashReserve(Number(event.target.value))}
          />
          <p className="text-xs text-muted-foreground">
            A safety threshold, not a claim of insolvency — the forecast flags any period projected
            to fall below this figure.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Default Collection Delay (days)</Label>
            <Input
              type="number"
              min="0"
              value={defaultCollectionDelayDays}
              onChange={(event) => setDefaultCollectionDelayDays(Number(event.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Default Payment Delay (days)</Label>
            <Input
              type="number"
              min="0"
              value={defaultPaymentDelayDays}
              onChange={(event) => setDefaultPaymentDelayDays(Number(event.target.value))}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Applied on top of each invoice&apos;s own due date when neither a scenario nor a
          per-invoice adjustment overrides it.
        </p>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to save settings.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Save Settings'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
