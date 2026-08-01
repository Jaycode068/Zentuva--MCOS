'use client';

import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent } from '@zentuva/ui';

import { AccountTabs } from '@/components/app/account-tabs';
import { AccountSession, getAccountSessions, revokeSession } from '@/lib/account';
import { ApiError, clearTokens } from '@/lib/api-client';
import { parseUserAgent } from '@/lib/parse-user-agent';

/** Sprint 3.3 §4 "Active Sessions" — one row per `Session` returned by
 *  `GET /api/account/sessions`. Revoking the current session (brief: "logs the user out
 *  immediately") clears local tokens and redirects to `/login`; revoking any other
 *  session just removes it from the list. */
export default function AccountSessionsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['account', 'sessions'],
    queryFn: getAccountSessions,
  });

  const mutation = useMutation({
    mutationFn: (id: string) => revokeSession(id),
    onSuccess: (result) => {
      if (result.wasCurrentSession) {
        clearTokens();
        router.push('/login');
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['account', 'sessions'] });
    },
  });

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Active Sessions</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Devices currently signed in to your Zentuva account.
        </p>
      </div>

      <AccountTabs />

      {isLoading && <p className="text-sm text-muted-foreground">Loading sessions…</p>}

      {isError && (
        <p className="text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load sessions.'}
        </p>
      )}

      {data && (
        <div className="space-y-3">
          {data.items.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              onRevoke={() => mutation.mutate(session.id)}
              isRevoking={mutation.isPending && mutation.variables === session.id}
            />
          ))}
        </div>
      )}
    </main>
  );
}

function SessionRow({
  session,
  onRevoke,
  isRevoking,
}: {
  session: AccountSession;
  onRevoke: () => void;
  isRevoking: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-4 py-4">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-foreground">
              {parseUserAgent(session.userAgent)}
            </p>
            {session.isCurrent && <Badge variant="success">Current Device</Badge>}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            IP {session.ipAddress ?? 'unknown'} · Created{' '}
            {new Date(session.createdAt).toLocaleString()} · Last active{' '}
            {new Date(session.lastActivityAt).toLocaleString()}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onRevoke} disabled={isRevoking}>
          {isRevoking ? 'Logging out…' : 'Logout'}
        </Button>
      </CardContent>
    </Card>
  );
}
