'use client';

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
} from '@zentuva/ui';
import { registerConsumerSchema, type RegisterConsumerInput } from '@zentuva/validation';
import { useForm } from 'react-hook-form';

import { ApiError } from '@/lib/api-client';

import { listTerritories } from '../../retail/api';
import {
  activateConsumer,
  deactivateConsumer,
  getConsumer,
  listConsumers,
  registerConsumer,
  reportConsumerLocationNotFound,
  suspendConsumer,
  updateConsumerLocation,
  type ConsumerStatus,
} from './api';

/**
 * Sprint 32 — Consumer Identity, Territory & Location Foundation
 * (docs/domains/d2c.md). Minimal internal/admin verification surface —
 * NOT the eventual Sprint 39 D2C Sales Administration dashboard, and NOT
 * the future WhatsApp/consumer-facing UI. Just enough to register a
 * consumer, confirm phone identity/dedup, assign a structured location,
 * and change status, using the existing settings shell/component kit —
 * same "lightweight list/detail/location view" scope the brief allows.
 */
export default function ConsumersPage() {
  const [statusFilter, setStatusFilter] = useState<'' | ConsumerStatus>('');
  const [search, setSearch] = useState('');
  const [registerOpen, setRegisterOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['d2c-consumers', statusFilter, search],
    queryFn: () =>
      listConsumers({ status: statusFilter || undefined, search: search || undefined }),
  });
  const { data: territoriesData } = useQuery({
    queryKey: ['territories'],
    queryFn: () => listTerritories({ status: 'ACTIVE' }),
  });
  const territories = territoriesData?.items ?? [];
  const territoryName = (id: string | null) =>
    id ? (territories.find((t) => t.id === id)?.name ?? id) : '—';

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['d2c-consumers'] });

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">D2C Consumers</h1>
          <p className="text-sm text-muted-foreground">
            Consumer identity &amp; structured location foundation — internal verification view
            only.
          </p>
        </div>
        <Button onClick={() => setRegisterOpen(true)}>Register Consumer</Button>
      </div>

      <div className="flex flex-wrap gap-3">
        <Input
          placeholder="Search name, code, or phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as ConsumerStatus | '')}
          className="max-w-[160px]"
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="INACTIVE">Inactive</option>
        </Select>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {isError && (
        <p className="text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load consumers.'}
        </p>
      )}

      {data && data.items.length === 0 && (
        <p className="text-sm text-muted-foreground">No consumers match this filter.</p>
      )}

      <div className="divide-y divide-border rounded-lg border border-border">
        {data?.items.map((consumer) => (
          <button
            key={consumer.id}
            type="button"
            onClick={() => setSelectedId(consumer.id)}
            className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-muted/50"
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium">{consumer.fullName}</span>
                <Badge
                  variant={
                    consumer.status === 'ACTIVE'
                      ? 'success'
                      : consumer.status === 'SUSPENDED'
                        ? 'warning'
                        : 'default'
                  }
                >
                  {consumer.status}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {consumer.consumerCode} · {consumer.normalizedPhone} ·{' '}
                {territoryName(consumer.territoryId)}
              </p>
            </div>
          </button>
        ))}
      </div>

      {registerOpen && (
        <RegisterConsumerDialog
          territories={territories}
          onOpenChange={setRegisterOpen}
          onSaved={() => {
            invalidate();
          }}
        />
      )}

      {selectedId && (
        <ConsumerDetailDialog
          id={selectedId}
          territories={territories}
          onOpenChange={(open) => !open && setSelectedId(null)}
          onChanged={() => {
            invalidate();
            refetch();
          }}
        />
      )}
    </div>
  );
}

function RegisterConsumerDialog({
  territories,
  onOpenChange,
  onSaved,
}: {
  territories: { id: string; name: string }[];
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const form = useForm<RegisterConsumerInput>({
    resolver: zodResolver(registerConsumerSchema),
    defaultValues: { fullName: '', phoneNumber: '', email: '', address: '', marketingOptIn: false },
  });
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (values: RegisterConsumerInput) =>
      registerConsumer({
        ...values,
        email: values.email || undefined,
        territoryId: values.territoryId || undefined,
        address: values.address || undefined,
      }),
    onSuccess: (consumer) => {
      setResultMessage(
        consumer.alreadyRegistered
          ? `This phone number is already registered as ${consumer.consumerCode} (${consumer.fullName}) — no duplicate was created.`
          : `Registered as ${consumer.consumerCode}.`,
      );
      onSaved();
    },
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Register Consumer</DialogTitle>
      </DialogHeader>
      <form className="space-y-4" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
        <div className="space-y-1.5">
          <Label>Full Name</Label>
          <Input {...form.register('fullName')} />
          {form.formState.errors.fullName && (
            <p className="text-xs text-destructive">{form.formState.errors.fullName.message}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label>Phone Number</Label>
          <Input placeholder="08012345678" {...form.register('phoneNumber')} />
          {form.formState.errors.phoneNumber && (
            <p className="text-xs text-destructive">{form.formState.errors.phoneNumber.message}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label>Email (optional)</Label>
          <Input type="email" {...form.register('email')} />
        </div>
        <div className="space-y-1.5">
          <Label>Territory / Location (optional)</Label>
          <Select {...form.register('territoryId')}>
            <option value="">Not set</option>
            {territories.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Address (optional)</Label>
          <Input {...form.register('address')} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" {...form.register('marketingOptIn')} />
          Opt in to promotional messages
        </label>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError ? mutation.error.message : 'Registration failed.'}
          </p>
        )}
        {resultMessage && <p className="text-sm text-muted-foreground">{resultMessage}</p>}

        <DialogFooter>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Registering…' : 'Register'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

function ConsumerDetailDialog({
  id,
  territories,
  onOpenChange,
  onChanged,
}: {
  id: string;
  territories: { id: string; name: string }[];
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const { data: consumer, refetch } = useQuery({
    queryKey: ['d2c-consumer', id],
    queryFn: () => getConsumer(id),
  });
  const [notFoundText, setNotFoundText] = useState('');

  const locationMutation = useMutation({
    mutationFn: (territoryId: string | null) => updateConsumerLocation(id, territoryId),
    onSuccess: () => {
      refetch();
      onChanged();
    },
  });
  const statusMutation = useMutation({
    mutationFn: (action: 'activate' | 'suspend' | 'deactivate') => {
      if (action === 'activate') return activateConsumer(id);
      if (action === 'suspend') return suspendConsumer(id);
      return deactivateConsumer(id);
    },
    onSuccess: () => {
      refetch();
      onChanged();
    },
  });
  const notFoundMutation = useMutation({
    mutationFn: (text: string) => reportConsumerLocationNotFound(id, text),
    onSuccess: () => setNotFoundText(''),
  });

  if (!consumer) return null;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>{consumer.fullName}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div className="rounded-md border border-dashed border-border bg-muted/50 p-3 text-sm">
          <p className="font-mono">{consumer.consumerCode}</p>
          <p className="text-muted-foreground">
            {consumer.phoneNumber} → {consumer.normalizedPhone}
          </p>
          {consumer.email && <p className="text-muted-foreground">{consumer.email}</p>}
        </div>

        <div className="space-y-1.5">
          <Label>Territory / Location</Label>
          <Select
            defaultValue={consumer.territoryId ?? ''}
            onChange={(e) => locationMutation.mutate(e.target.value || null)}
          >
            <option value="">Not set</option>
            {territories.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={consumer.status === 'ACTIVE'}
            onClick={() => statusMutation.mutate('activate')}
          >
            Activate
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={consumer.status === 'SUSPENDED'}
            onClick={() => statusMutation.mutate('suspend')}
          >
            Suspend
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={consumer.status === 'INACTIVE'}
            onClick={() => statusMutation.mutate('deactivate')}
          >
            Deactivate
          </Button>
        </div>

        <div className="space-y-1.5 border-t border-border pt-4">
          <Label>Can&apos;t find their location? Log it for review</Label>
          <div className="flex gap-2">
            <Input
              placeholder="e.g. somewhere around Challenge"
              value={notFoundText}
              onChange={(e) => setNotFoundText(e.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!notFoundText.trim() || notFoundMutation.isPending}
              onClick={() => notFoundMutation.mutate(notFoundText.trim())}
            >
              Log
            </Button>
          </div>
          {notFoundMutation.isSuccess && (
            <p className="text-xs text-muted-foreground">
              Logged — never auto-creates a Territory; visible to admins for review.
            </p>
          )}
        </div>
      </div>
    </Dialog>
  );
}
