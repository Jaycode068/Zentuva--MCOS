'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button } from '@zentuva/ui';

import { ApiError } from '@/lib/api-client';

import { listUsers, OrgUser, updateUser } from './api';
import { CreateUserDialog } from './create-user-dialog';
import { EditUserDialog } from './edit-user-dialog';

export default function UsersSettingsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['users'], queryFn: listUsers });
  const [createOpen, setCreateOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<OrgUser | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['users'] });

  const toggleStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'ACTIVE' | 'INACTIVE' }) =>
      updateUser(id, { status }),
    onSuccess: invalidate,
  });

  if (isLoading) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10 text-sm text-muted-foreground">
        Loading users…
      </main>
    );
  }

  if (isError) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <p className="text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load users.'}
        </p>
      </main>
    );
  }

  const users = data?.items ?? [];

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage who has access to this organisation.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>Create User</Button>
      </div>

      {toggleStatusMutation.isError && (
        <p className="mb-4 text-sm text-destructive">
          {toggleStatusMutation.error instanceof ApiError
            ? toggleStatusMutation.error.message
            : 'Failed to update user status.'}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/50 text-left">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Employee Code</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3">
                  {user.firstName} {user.lastName}
                </td>
                <td className="px-4 py-3">{user.email}</td>
                <td className="px-4 py-3">{user.employeeCode ?? '—'}</td>
                <td className="px-4 py-3">{user.role ?? '—'}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={user.status} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => setEditingUser(user)}>
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={toggleStatusMutation.isPending}
                      onClick={() =>
                        toggleStatusMutation.mutate({
                          id: user.id,
                          status: user.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
                        })
                      }
                    >
                      {user.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No users yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={invalidate} />
      {editingUser && (
        <EditUserDialog
          user={editingUser}
          onOpenChange={() => setEditingUser(null)}
          onUpdated={invalidate}
        />
      )}
    </main>
  );
}

function StatusBadge({ status }: { status: OrgUser['status'] }) {
  const variant = status === 'ACTIVE' ? 'success' : status === 'LOCKED' ? 'destructive' : 'default';
  return <Badge variant={variant}>{status}</Badge>;
}
