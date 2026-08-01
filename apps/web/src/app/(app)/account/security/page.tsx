'use client';

import { useQuery } from '@tanstack/react-query';
import { Badge, buttonVariants, Card, CardContent, CardHeader, CardTitle, cn } from '@zentuva/ui';

import { AccountTabs } from '@/components/app/account-tabs';
import { getAccountProfile } from '@/lib/account';
import { ApiError } from '@/lib/api-client';

/** Sprint 3.3 §7 "Security Improvements" — every value here comes straight from the
 *  `GET /api/account/profile` response (which already carries these fields for the
 *  Profile page's read-only section, see `AccountController.buildProfileResponse`), per
 *  the brief's "these can initially come from existing data." No new endpoint. */
export default function AccountSecurityPage() {
  const {
    data: profile,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['account', 'profile'],
    queryFn: getAccountProfile,
  });

  if (isLoading) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10 text-sm text-muted-foreground">
        Loading security information…
      </main>
    );
  }

  if (isError || !profile) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <AccountTabs />
        <p className="text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load security information.'}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Security</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review your account&apos;s security status and manage your password.
        </p>
      </div>

      <AccountTabs />

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Password</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-foreground">
                Last changed:{' '}
                {profile.passwordChangedAt
                  ? new Date(profile.passwordChangedAt).toLocaleString()
                  : 'Never — still using your original password'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Changing your password signs you out of every other device.
              </p>
            </div>
            <a href="/change-password" className={cn(buttonVariants({ size: 'sm' }))}>
              Change Password
            </a>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Account Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Status</span>
              <Badge variant={profile.status === 'ACTIVE' ? 'success' : 'warning'}>
                {profile.status}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Last Login</span>
              <span className="text-sm text-foreground">
                {profile.lastLoginAt ? new Date(profile.lastLoginAt).toLocaleString() : 'Never'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Failed Login Attempts</span>
              <span className="text-sm text-foreground">{profile.failedLoginAttempts}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
