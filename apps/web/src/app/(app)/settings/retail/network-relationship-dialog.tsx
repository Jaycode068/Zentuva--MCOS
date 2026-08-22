'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Button,
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Select,
  Textarea,
} from '@zentuva/ui';
import {
  createNetworkRelationshipSchema,
  type CreateNetworkRelationshipInput,
} from '@zentuva/validation';
import { useForm } from 'react-hook-form';

import { ApiError } from '@/lib/api-client';

import { createNetworkRelationship, listCustomers } from './api';
import { RELATIONSHIP_TYPE_LABELS } from './labels';

/**
 * Create Distribution Network Relationship dialog (Sprint 4.8,
 * docs/domains/retail-network.md). Always creates a NEW relationship — an existing one
 * is only ever deactivated, never re-pointed (changing an endpoint would rewrite the
 * network's history). No relationship is ever required for a customer to exist or place
 * a Sales Order; this dialog is purely additive market intelligence.
 */
export function NetworkRelationshipDialog({
  onOpenChange,
  onSaved,
}: {
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { data: customersData } = useQuery({
    queryKey: ['customers-for-network'],
    queryFn: () => listCustomers({ status: 'ACTIVE' }),
  });
  const customers = customersData?.items ?? [];

  const form = useForm<CreateNetworkRelationshipInput>({
    resolver: zodResolver(createNetworkRelationshipSchema),
    defaultValues: {
      sourceCustomerId: '',
      targetCustomerId: '',
      relationshipType: 'DISTRIBUTES_TO',
    },
  });

  const mutation = useMutation({
    // The form never collects `effectiveFrom`/`effectiveTo` (the server defaults
    // `effectiveFrom` to now) — only pass the fields this dialog actually gathers,
    // avoiding a `Date` vs. wire-string mismatch on the omitted ones.
    mutationFn: (values: CreateNetworkRelationshipInput) =>
      createNetworkRelationship({
        sourceCustomerId: values.sourceCustomerId,
        targetCustomerId: values.targetCustomerId,
        relationshipType: values.relationshipType,
        notes: values.notes || undefined,
      }),
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
  });

  if (!customersData) {
    return (
      <Dialog open onOpenChange={onOpenChange}>
        <DialogHeader>
          <DialogTitle>Create Network Relationship</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Create Network Relationship</DialogTitle>
      </DialogHeader>
      <form className="space-y-4" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
        <div className="space-y-1.5">
          <Label>Source Customer (supplies)</Label>
          <Select {...form.register('sourceCustomerId')}>
            <option value="">Select a customer…</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.customerName}
              </option>
            ))}
          </Select>
          {form.formState.errors.sourceCustomerId && (
            <p className="text-xs text-destructive">
              {form.formState.errors.sourceCustomerId.message}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>Relationship Type</Label>
          <Select {...form.register('relationshipType')}>
            {Object.entries(RELATIONSHIP_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Target Customer (receives)</Label>
          <Select {...form.register('targetCustomerId')}>
            <option value="">Select a customer…</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.customerName}
              </option>
            ))}
          </Select>
          {form.formState.errors.targetCustomerId && (
            <p className="text-xs text-destructive">
              {form.formState.errors.targetCustomerId.message}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>Notes (optional)</Label>
          <Textarea rows={2} {...form.register('notes')} />
        </div>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to create relationship.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Create Relationship'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
