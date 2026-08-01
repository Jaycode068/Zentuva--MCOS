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

import { getAccountProfile } from '@/lib/account';
import { useApplyBranding } from '@/lib/branding';
import { logout } from '@/lib/auth';
import { orgInitialsFor } from '@/lib/org-initials';
import { getWorkspaceSettings } from '@/lib/settings';

import { Container } from '../marketing/container';
import { Logo } from '../marketing/logo';

/**
 * Top navigation for authenticated pages (Sprint 3.2 brief: "Logo, Organisation Name,
 * User Avatar, Logout"; Sprint 3.3 replaces the bare Logout button with a dropdown menu —
 * "My Profile / Security / Active Sessions / Logout").
 *
 * Sprint 3.3 switched the data source from Sprint 3.2's `GET /api/users/:id` + client-side
 * JWT decode to `GET /api/account/profile` — one request covers both the display name/
 * initials this component needs *and* the `mustChangePassword` flag that gates every
 * `/settings/*`/`/account/*` page.
 *
 * Sprint 3.4 adds a second query, `GET /api/settings/workspace`, and applies its
 * primary/accent colours + theme via {@link useApplyBranding} — this is *the* place
 * tenant branding gets applied "immediately throughout the application" (brief
 * acceptance criteria), since this component renders on every authenticated page. It
 * also renders the organisation's own logo (or a colour-matched initials avatar when
 * none is uploaded) next to the organisation name, alongside — not replacing — the
 * Zentuva product mark.
 */
export function AuthenticatedNav() {
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
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <Container className="flex h-16 items-center justify-between">
        <div className="flex items-center gap-3">
          <a href="/settings/organisation" aria-label="Zentuva home">
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
            className="flex h-8 w-8 items-center justify-center rounded-full bg-brandPurple text-xs font-semibold text-brandPurple-foreground transition-opacity hover:opacity-90"
            aria-label="Account menu"
          >
            {initials}
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
