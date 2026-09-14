'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Dialog,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
} from '@zentuva/ui';

import { AccessTabs } from '@/components/app/access-tabs';
import { ApiError } from '@/lib/api-client';

import { createRole, listRoles } from '../api';
import { ROLE_STATUS_LABELS, ROLE_STATUS_VARIANT } from '../labels';

export default function RolesPage() {
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['access-roles'],
    queryFn: () => listRoles(),
  });

  const roles = data ?? [];

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Access Control</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Roles — bundles of permissions assignable to users. A role&apos;s name never determines
            behaviour; only its granted permissions do.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>New Role</Button>
      </div>

      <AccessTabs />

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading roles…</p>
      )}
      {isError && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-destructive">
            {error instanceof ApiError ? error.message : 'Failed to load roles.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Users</th>
                <th className="px-4 py-3">Permissions</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => (
                <tr key={role.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium">{role.name}</td>
                  <td className="max-w-xs truncate px-4 py-3 text-muted-foreground">
                    {role.description ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {role.isSystem ? 'System' : 'Custom'}
                  </td>
                  <td className="px-4 py-3">{role.userCount}</td>
                  <td className="px-4 py-3">{role.permissionCount}</td>
                  <td className="px-4 py-3">
                    <Badge variant={ROLE_STATUS_VARIANT[role.status]}>
                      {ROLE_STATUS_LABELS[role.status]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        window.location.href = `/settings/access/roles/${role.id}`;
                      }}
                    >
                      View
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && (
        <CreateRoleDialog
          onClose={() => setCreateOpen(false)}
          onSaved={(id) => {
            setCreateOpen(false);
            window.location.href = `/settings/access/roles/${id}`;
          }}
        />
      )}
    </main>
  );
}

function CreateRoleDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      createRole({ name: name.trim(), description: description.trim() || undefined }),
    onSuccess: (role) => onSaved(role.id),
  });

  const canSubmit = name.trim().length > 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogHeader>
        <DialogTitle>New Role</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) mutation.mutate();
        }}
      >
        <div className="space-y-1.5">
          <Label>Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Warehouse Supervisor"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Description</Label>
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <p className="text-xs text-muted-foreground">
          You&apos;ll configure this role&apos;s permissions on the next screen.
        </p>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError ? mutation.error.message : 'Failed to create role.'}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit || mutation.isPending}>
            {mutation.isPending ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
