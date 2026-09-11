'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';

import { getAccountProfile } from '@/lib/account';
import { ApiError, clearTokens, getAccessToken } from '@/lib/api-client';
import { useApplyBranding } from '@/lib/branding';
import { getWorkspaceSettings } from '@/lib/settings';

import { TechnicianHeader } from './TechnicianHeader';

/**
 * The mobile-first Field Technician Maintenance shell (Sprint 22) — a slim
 * header over the two Maintenance screens (My Work Orders, Work Order
 * detail). Deliberately its own route group, separate from the Field
 * Sales shell (`(field)`): a Field Sales agent's job is customers,
 * outlets, orders, and deliveries, and has no business with Maintenance
 * data; a Maintenance technician's job is work orders, and has no
 * business with Sales/Customer/Order data. Keeping them as two distinct
 * shells (own header, own layout, no shared bottom nav) means that once a
 * real Technician RBAC role exists, it maps onto a UI surface that
 * already only exposes what that role should see — no retrofit needed.
 *
 * No bottom tab bar: unlike Field Sales' five destinations, this shell
 * has exactly one top-level screen (My Work Orders) plus its own detail
 * view, so a tab bar would have nothing else to navigate to. The header's
 * back chevron is the only navigation this surface needs.
 */
export function TechnicianShell({ children }: { children: React.ReactNode }) {
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
      <TechnicianHeader />
      <main className="flex-1 overflow-y-auto pb-6">{children}</main>
    </div>
  );
}
