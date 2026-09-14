'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Badge, Button, Dialog, DialogHeader, DialogTitle, Select } from '@zentuva/ui';

import { AccessTabs } from '@/components/app/access-tabs';
import { ApiError } from '@/lib/api-client';

import {
  UserAccessRow,
  assignUserRole,
  getEffectiveAccess,
  listRoles,
  listUserAccess,
  removeUserRole,
} from '../api';
import { ACCESS_SCOPE_LABELS, ROLE_STATUS_VARIANT } from '../labels';

export default function UserAccessPage() {
  const [previewUserId, setPreviewUserId] = useState<string | null>(null);
  const [assignForUserId, setAssignForUserId] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['access-user-list'],
    queryFn: () => listUserAccess(),
  });

  const rows = data?.items ?? [];

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Access Control</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          User Access — assign or remove roles. A user may hold multiple roles at once.
        </p>
      </div>

      <AccessTabs />

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading users…</p>
      )}
      {isError && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-destructive">
            {error instanceof ApiError ? error.message : 'Failed to load user access.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && (
        <div className="space-y-2">
          {rows.map((row) => (
            <UserAccessCard
              key={row.userId}
              row={row}
              onPreview={() => setPreviewUserId(row.userId)}
              onAssign={() => setAssignForUserId(row.userId)}
              onChanged={refetch}
            />
          ))}
        </div>
      )}

      {previewUserId && (
        <EffectiveAccessPreviewDialog
          userId={previewUserId}
          onClose={() => setPreviewUserId(null)}
        />
      )}
      {assignForUserId && (
        <AssignRoleDialog
          userId={assignForUserId}
          onClose={() => setAssignForUserId(null)}
          onSaved={() => {
            setAssignForUserId(null);
            refetch();
          }}
        />
      )}
    </main>
  );
}

function UserAccessCard({
  row,
  onPreview,
  onAssign,
  onChanged,
}: {
  row: UserAccessRow;
  onPreview: () => void;
  onAssign: () => void;
  onChanged: () => void;
}) {
  const removeMutation = useMutation({
    mutationFn: (roleId: string) => removeUserRole(row.userId, roleId),
    onSuccess: onChanged,
  });

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium">
            {row.firstName} {row.lastName}
          </p>
          <p className="text-xs text-muted-foreground">{row.email}</p>
          {row.employee ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {row.employee.employeeCode} · {row.employee.department?.name ?? 'No department'} ·{' '}
              {row.employee.position?.title ?? 'No position'} ·{' '}
              {row.employee.manager
                ? `Reports to ${row.employee.manager.firstName} ${row.employee.manager.lastName}`
                : 'No manager'}{' '}
              · {row.employee.employmentStatus}
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">No linked employee record</p>
          )}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onPreview}>
            Effective Access
          </Button>
          <Button size="sm" variant="outline" onClick={onAssign}>
            Add Role
          </Button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {row.roles.length === 0 && (
          <span className="text-xs text-destructive">No roles assigned</span>
        )}
        {row.roles.map((role) => (
          <Badge key={role.id} variant={ROLE_STATUS_VARIANT[role.status]}>
            {role.name}
            <button
              type="button"
              className="ml-2 text-xs opacity-70 hover:opacity-100"
              disabled={removeMutation.isPending}
              onClick={() => removeMutation.mutate(role.id)}
              aria-label={`Remove ${role.name}`}
            >
              ×
            </button>
          </Badge>
        ))}
      </div>
    </div>
  );
}

function AssignRoleDialog({
  userId,
  onClose,
  onSaved,
}: {
  userId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [roleId, setRoleId] = useState('');
  const { data: roles } = useQuery({ queryKey: ['access-roles'], queryFn: () => listRoles() });
  const activeRoles = (roles ?? []).filter((r) => r.status === 'ACTIVE');

  const mutation = useMutation({
    mutationFn: () => assignUserRole(userId, roleId),
    onSuccess: onSaved,
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogHeader>
        <DialogTitle>Assign Role</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (roleId) mutation.mutate();
        }}
      >
        <Select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
          <option value="">Select a role</option>
          {activeRoles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </Select>
        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError ? mutation.error.message : 'Failed to assign role.'}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!roleId || mutation.isPending}>
            {mutation.isPending ? 'Assigning…' : 'Assign'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function EffectiveAccessPreviewDialog({
  userId,
  onClose,
}: {
  userId: string;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['access-effective', userId],
    queryFn: () => getEffectiveAccess(userId),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogHeader>
        <DialogTitle>Effective Access</DialogTitle>
      </DialogHeader>
      <div className="max-h-[70vh] space-y-3 overflow-y-auto">
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {data && (
          <>
            {!data.userIsActive && (
              <p className="text-sm text-destructive">
                This user&apos;s account is not active — they have no effective access at all.
              </p>
            )}
            {data.isOwnerBypass && (
              <p className="text-sm text-muted-foreground">
                This user holds the Owner role — full access to everything, bypassing the permission
                catalogue entirely.
              </p>
            )}
            {data.userIsActive && !data.isOwnerBypass && (
              <div className="space-y-2">
                {data.grants.length === 0 && (
                  <p className="text-sm text-muted-foreground">No effective permissions.</p>
                )}
                {data.grants.map((grant) => (
                  <div
                    key={grant.permissionKey}
                    className="rounded-md border border-border p-2 text-sm"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs">{grant.permissionKey}</span>
                      <span className="text-xs text-muted-foreground">
                        via {grant.sourceRoleNames.join(', ')}
                      </span>
                    </div>
                    {grant.scopeType === 'SCOPABLE' && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Scope:{' '}
                        {grant.scopes.length === 0
                          ? 'none granted'
                          : grant.scopes.map((s) => ACCESS_SCOPE_LABELS[s]).join(', ')}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
