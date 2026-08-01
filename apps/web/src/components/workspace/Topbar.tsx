'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@zentuva/ui';

import { Container } from '@/components/marketing/container';
import { Logo } from '@/components/marketing/logo';
import { getAccountProfile } from '@/lib/account';
import { useApplyBranding } from '@/lib/branding';
import { logout } from '@/lib/auth';
import { orgInitialsFor } from '@/lib/org-initials';
import { getWorkspaceSettings } from '@/lib/settings';

import { MenuIcon } from './icons';

/**
 * Top navigation bar for the Workspace shell — the direct successor to Sprint 3.2/3.3/3.4's
 * `AuthenticatedNav`, moved here and renamed as part of the Sprint 3.5 shell so every
 * authenticated page renders it exactly once via `WorkspaceLayout` rather than each
 * route's own `layout.tsx` importing it separately. All of `AuthenticatedNav`'s behaviour
 * carries over unchanged: it fetches the account profile and workspace settings, applies
 * tenant branding (`useApplyBranding`) as a side effect on every authenticated page, and
 * redirects to `/change-password` when `mustChangePassword` is set. New in this sprint: a
 * hamburger button that opens the mobile sidebar drawer, and the account-menu trigger now
 * shows the uploaded profile photo (Sprint 3.5 fix) instead of always falling back to
 * initials.
 */
export function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
  const router = useRouter();

  const { data: profile } = useQuery({
    queryKey: ['account', 'profile'],
    queryFn: getAccountProfile,
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
    if (profile?.mustChangePassword) {
      router.replace('/change-password');
    }
  }, [profile?.mustChangePassword, router]);

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  const initials = profile
    ? `${profile.firstName.charAt(0)}${profile.lastName.charAt(0)}`.toUpperCase()
    : '';

  const orgName = workspace?.organisationName ?? profile?.organisation?.name;
  const orgInitials = orgName ? orgInitialsFor(orgName) : '';

  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <Container className="flex h-16 items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onMenuClick}
            className="-ml-2 flex h-9 w-9 items-center justify-center rounded-md text-foreground/70 hover:bg-accent hover:text-accent-foreground lg:hidden"
            aria-label="Open navigation"
          >
            <MenuIcon className="h-5 w-5" />
          </button>

          <a href="/workspace" aria-label="Zentuva home">
            <Logo />
          </a>
          {orgName && (
            <>
              <span className="hidden h-5 w-px bg-border sm:block" aria-hidden="true" />
              <div className="hidden items-center gap-2 sm:flex">
                {workspace?.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- external/user-uploaded URL, not a static asset next/image can optimise
                  <img src={workspace.logoUrl} alt="" className="h-6 w-6 rounded object-contain" />
                ) : (
                  <div
                    className="flex h-6 w-6 items-center justify-center rounded bg-primary text-[10px] font-semibold text-primary-foreground"
                    aria-hidden="true"
                  >
                    {orgInitials}
                  </div>
                )}
                <span className="text-sm font-medium text-muted-foreground">{orgName}</span>
              </div>
            </>
          )}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-brandPurple text-xs font-semibold text-brandPurple-foreground transition-opacity hover:opacity-90"
            aria-label="Account menu"
          >
            {profile?.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- user-uploaded URL
              <img src={profile.avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              initials
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {profile && (
              <>
                <DropdownMenuLabel>
                  <p className="font-medium text-foreground">
                    {profile.firstName} {profile.lastName}
                  </p>
                  <p className="truncate font-normal">{profile.email}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onSelect={() => router.push('/account/profile')}>
              My Profile
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => router.push('/account/security')}>
              Security
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => router.push('/account/sessions')}>
              Active Sessions
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleLogout} className="text-destructive">
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Container>
    </header>
  );
}
