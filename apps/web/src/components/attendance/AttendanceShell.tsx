'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';

import { getAccountProfile } from '@/lib/account';
import { ApiError, clearTokens, getAccessToken } from '@/lib/api-client';
import { useApplyBranding } from '@/lib/branding';
import { getWorkspaceSettings } from '@/lib/settings';

import { AttendanceHeader } from './AttendanceHeader';

/**
 * Self-service Attendance shell (Sprint 24) — its own route group, the
 * exact `TechnicianShell` rationale (Sprint 22): sign-in/sign-out is an
 * HR concern any employee may need, regardless of whether they are a
 * Field Sales agent, a Field Technician, or an office employee, so it is
 * deliberately not bolted onto either of those existing shells. No bottom
 * tab bar — one screen, one job.
 */
export function AttendanceShell({ children }: { children: React.ReactNode }) {
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
      <AttendanceHeader />
      <main className="flex-1 overflow-y-auto pb-6">{children}</main>
    </div>
  );
}
