'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';

import { getAccountProfile } from '@/lib/account';
import { ApiError, clearTokens, getAccessToken } from '@/lib/api-client';
import { useApplyBranding } from '@/lib/branding';
import { getWorkspaceSettings } from '@/lib/settings';

import { FieldBottomNav } from './FieldBottomNav';
import { FieldHeader } from './FieldHeader';

/**
 * The mobile-first Field Sales shell (Sprint 4.8) — a slim header + sticky bottom tab
 * bar, deliberately not `WorkspaceLayout`. Brings its own auth guard since `(app)` has
 * none of its own (unauthenticated users there simply get 401s from every query): a
 * synchronous `getAccessToken()` check redirects immediately, and the same account-
 * profile query `Topbar` runs (React Query dedupes it across surfaces) both confirms the
 * token is actually valid (401 -> redirect + clear) and enforces the same forced
 * first-login password change.
 *
 * Layout is deliberately always-narrow and centered — `max-w-md` — even on a desktop
 * viewport, rather than progressively enhancing to a wider layout above phone width.
 * The Admin surface already serves the "sales manager on a laptop" case; letting Field
 * Sales grow a second, wider layout would be a second UI to design and test for a
 * scenario (a field agent on a laptop) the brief doesn't ask for.
 */
export function FieldShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace('/login');
    }
  }, [router]);

  const { data: profile, error } = useQuery({
    queryKey: ['account', 'profile'],
    queryFn: getAccountProfile,
    retry: false,
  });
  const { data: workspace } = useQuery({
    queryKey: ['settings', 'workspace'],
    queryFn: getWorkspaceSettings,
  });

  useApplyBranding(
    workspace && {
      primaryColor: workspace.primaryColor,
      accentColor: workspace.accentColor,
      theme: workspace.theme,
    },
  );

  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) {
      clearTokens();
      router.replace('/login');
    }
  }, [error, router]);

  useEffect(() => {
    if (profile?.mustChangePassword) {
      router.replace('/change-password');
    }
  }, [profile?.mustChangePassword, router]);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-background">
      <FieldHeader />
      <main className="flex-1 overflow-y-auto pb-24">{children}</main>
      <FieldBottomNav />
    </div>
  );
}
