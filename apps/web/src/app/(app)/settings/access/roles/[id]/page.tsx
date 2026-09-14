'use client';

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Dialog,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
} from '@zentuva/ui';

import { ApiError } from '@/lib/api-client';

import {
  AccessScope,
  PermissionGrantInput,
  archiveRole,
  duplicateRole,
  getRole,
  listPermissions,
  restoreRole,
  setRolePermissions,
  updateRole,
} from '../../api';
import { ACCESS_SCOPE_LABELS, ROLE_STATUS_LABELS, ROLE_STATUS_VARIANT } from '../../labels';

const SCOPE_OPTIONS: AccessScope[] = [
  'ORGANISATION',
  'OWN_RECORDS',
  'OWN_TEAM',
  'DEPARTMENT',
  'ASSIGNED_RECORDS',
  'ASSIGNED_TERRITORY',
  'ASSIGNED_ASSETS',
  'NONE',
];

interface GrantState {
  checked: boolean;
  scope?: AccessScope;
}

export default function RoleDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const queryClient = useQueryClient();
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const { data: role, isLoading } = useQuery({
    queryKey: ['access-role', id],
    queryFn: () => getRole(id),
  });
  const { data: catalogue } = useQuery({
    queryKey: ['access-permissions-catalogue'],
    queryFn: () => listPermissions(),
  });

  const [grants, setGrants] = useState<Record<string, GrantState> | null>(null);

  const grouped = useMemo(() => {
    const items = catalogue?.items ?? [];
    const byModule = new Map<string, typeof items>();
    for (const p of items) {
      const list = byModule.get(p.domain) ?? [];
      list.push(p);
      byModule.set(p.domain, list);
    }
    return byModule;
  }, [catalogue]);

  if (grants === null && role) {
    const initial: Record<string, GrantState> = {};
    for (const grant of role.permissions) {
      initial[grant.permission.key] = { checked: true, scope: grant.scope ?? undefined };
    }
    setGrants(initial);
  }

  const archiveMutation = useMutation({
    mutationFn: () => archiveRole(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['access-role', id] }),
  });
  const restoreMutation = useMutation({
    mutationFn: () => restoreRole(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['access-role', id] }),
  });
  const saveNameMutation = useMutation({
    mutationFn: (payload: { name: string; description?: string }) => updateRole(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['access-role', id] }),
  });
  const savePermissionsMutation = useMutation({
    mutationFn: () => {
      const payload: PermissionGrantInput[] = Object.entries(grants ?? {})
        .filter(([, state]) => state.checked)
        .map(([permissionKey, state]) => ({ permissionKey, scope: state.scope }));
      return setRolePermissions(id, payload);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['access-role', id] }),
  });

  if (isLoading || !role) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <p className="text-center text-sm text-muted-foreground">Loading role…</p>
      </main>
    );
  }

  const readOnly = role.isSystem;

  function toggle(key: string, scopeType: 'NONE' | 'SCOPABLE') {
    setGrants((prev) => {
      const current = prev?.[key];
      const next = { ...(prev ?? {}) };
      if (current?.checked) {
        next[key] = { checked: false };
      } else {
        next[key] = { checked: true, scope: scopeType === 'SCOPABLE' ? 'ORGANISATION' : undefined };
      }
      return next;
    });
  }

  function setScope(key: string, scope: AccessScope) {
    setGrants((prev) => ({ ...(prev ?? {}), [key]: { checked: true, scope } }));
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <a href="/settings/access/roles" className="text-sm text-muted-foreground hover:underline">
        ← Back to Roles
      </a>

      <div className="mt-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{role.name}</h1>
          {role.description && (
            <p className="mt-1 text-sm text-muted-foreground">{role.description}</p>
          )}
        </div>
        <Badge variant={ROLE_STATUS_VARIANT[role.status]}>{ROLE_STATUS_LABELS[role.status]}</Badge>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {readOnly && (
          <p className="text-xs text-muted-foreground">
            System roles (Owner/Administrator/Member) cannot be renamed, archived, or have their
            permissions edited here.
          </p>
        )}
        {!readOnly && role.status === 'ACTIVE' && (
          <Button
            size="sm"
            variant="outline"
            disabled={archiveMutation.isPending}
            onClick={() => archiveMutation.mutate()}
          >
            Archive
          </Button>
        )}
        {!readOnly && role.status === 'ARCHIVED' && (
          <Button
            size="sm"
            disabled={restoreMutation.isPending}
            onClick={() => restoreMutation.mutate()}
          >
            Restore
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => setDuplicateOpen(true)}>
          Duplicate
        </Button>
        {!readOnly && (
          <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
            Edit Name / Description
          </Button>
        )}
      </div>

      <div className="mt-6 rounded-lg border border-border p-4">
        <h2 className="mb-3 text-sm font-semibold">Permissions</h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Grouped by module. A permission is either organisation-wide the moment it&apos;s checked,
          or, if scoped, requires an explicit scope — an unchecked scope never means unrestricted
          access.
        </p>
        <div className="space-y-6">
          {Array.from(grouped.entries()).map(([module, perms]) => (
            <div key={module}>
              <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                {module}
              </h3>
              <div className="space-y-2">
                {perms.map((permission) => {
                  const state = grants?.[permission.key];
                  return (
                    <div
                      key={permission.key}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                    >
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          disabled={readOnly}
                          checked={!!state?.checked}
                          onChange={() => toggle(permission.key, permission.scopeType)}
                        />
                        <span>
                          <span className="font-mono text-xs">{permission.key}</span>
                          {permission.description && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              {permission.description}
                            </span>
                          )}
                        </span>
                      </label>
                      {permission.scopeType === 'SCOPABLE' && state?.checked && (
                        <Select
                          value={state.scope ?? 'ORGANISATION'}
                          disabled={readOnly}
                          onChange={(e) => setScope(permission.key, e.target.value as AccessScope)}
                          className="w-56"
                        >
                          {SCOPE_OPTIONS.map((scope) => (
                            <option key={scope} value={scope}>
                              {ACCESS_SCOPE_LABELS[scope]}
                            </option>
                          ))}
                        </Select>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {!readOnly && (
          <div className="mt-6 flex items-center justify-end gap-2">
            {savePermissionsMutation.isError && (
              <p className="text-sm text-destructive">
                {savePermissionsMutation.error instanceof ApiError
                  ? savePermissionsMutation.error.message
                  : 'Failed to save permissions.'}
              </p>
            )}
            <Button
              disabled={savePermissionsMutation.isPending}
              onClick={() => savePermissionsMutation.mutate()}
            >
              {savePermissionsMutation.isPending ? 'Saving…' : 'Save Permissions'}
            </Button>
          </div>
        )}
      </div>

      {duplicateOpen && (
        <DuplicateRoleDialog
          sourceId={id}
          defaultName={`${role.name} (copy)`}
          onClose={() => setDuplicateOpen(false)}
          onSaved={(newId) => {
            window.location.href = `/settings/access/roles/${newId}`;
          }}
        />
      )}

      {editOpen && (
        <EditRoleDialog
          roleId={id}
          defaultName={role.name}
          defaultDescription={role.description ?? ''}
          mutation={saveNameMutation}
          onClose={() => setEditOpen(false)}
          onSaved={() => setEditOpen(false)}
        />
      )}
    </main>
  );
}

function EditRoleDialog({
  defaultName,
  defaultDescription,
  mutation,
  onClose,
  onSaved,
}: {
  roleId: string;
  defaultName: string;
  defaultDescription: string;
  mutation: ReturnType<
    typeof useMutation<unknown, unknown, { name: string; description?: string }>
  >;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState(defaultDescription);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogHeader>
        <DialogTitle>Edit Role</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) {
            mutation.mutate(
              { name: name.trim(), description: description.trim() || undefined },
              { onSuccess: onSaved },
            );
          }
        }}
      >
        <div className="space-y-1.5">
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Description</Label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError ? mutation.error.message : 'Failed to update role.'}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!name.trim() || mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function DuplicateRoleDialog({
  sourceId,
  defaultName,
  onClose,
  onSaved,
}: {
  sourceId: string;
  defaultName: string;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [name, setName] = useState(defaultName);
  const mutation = useMutation({
    mutationFn: () => duplicateRole(sourceId, name.trim()),
    onSuccess: (role) => onSaved(role.id),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogHeader>
        <DialogTitle>Duplicate Role</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) mutation.mutate();
        }}
      >
        <div className="space-y-1.5">
          <Label>New role name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to duplicate role.'}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!name.trim() || mutation.isPending}>
            {mutation.isPending ? 'Duplicating…' : 'Duplicate'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
