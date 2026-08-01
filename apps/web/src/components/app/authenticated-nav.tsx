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
import { logout } from '@/lib/auth';

import { Container } from '../marketing/container';
import { Logo } from '../marketing/logo';

/**
 * Top navigation for authenticated pages (Sprint 3.2 brief: "Logo, Organisation Name,
 * User Avatar, Logout"; Sprint 3.3 replaces the bare Logout button with a dropdown menu —
 * "My Profile / Security / Active Sessions / Logout").
 *
 * Sprint 3.3 also switches the data source from Sprint 3.2's `GET /api/users/:id` +
 * client-side JWT decode to the new `GET /api/account/profile` — one request now covers
 * both the display name/initials this component needs *and* the `mustChangePassword` flag
 * that gates every `/settings/*`/`/account/*` page (brief §5): if the flag is true, this
 * component redirects to `/change-password` before the user can see anything else.
 */
export function AuthenticatedNav() {
  const router = useRouter();

  const { data: profile } = useQuery({
    queryKey: ['account', 'profile'],
    queryFn: getAccountProfile,
  });

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

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <Container className="flex h-16 items-center justify-between">
        <div className="flex items-center gap-4">
          <a href="/settings/organisation" aria-label="Zentuva home">
            <Logo />
          </a>
          {profile?.organisation && (
            <>
              <span className="hidden h-5 w-px bg-border sm:block" aria-hidden="true" />
              <span className="hidden text-sm font-medium text-muted-foreground sm:inline">
                {profile.organisation.name}
              </span>
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
