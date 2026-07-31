'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';

import { getOrganisationProfile } from '@/app/settings/organisation/api';
import { getUser } from '@/app/settings/users/api';
import { getCurrentUserId } from '@/lib/api-client';
import { logout } from '@/lib/auth';

import { Container } from '../marketing/container';
import { Logo } from '../marketing/logo';

/**
 * Top navigation for authenticated pages (Sprint 3.2 brief: "Logo, Organisation Name,
 * User Avatar, Logout"). Reuses the existing `GET /api/organisation/me` and
 * `GET /api/users/:id` endpoints — no new backend surface. There is no dedicated
 * "current user" endpoint, so the user id comes from decoding the access token's `sub`
 * claim client-side (display only, never an authorization decision — see
 * `getCurrentUserId`).
 */
export function AuthenticatedNav() {
  const router = useRouter();
  const userId = getCurrentUserId();

  const { data: organisation } = useQuery({
    queryKey: ['organisation', 'me'],
    queryFn: getOrganisationProfile,
  });

  const { data: currentUser } = useQuery({
    queryKey: ['users', userId],
    queryFn: () => getUser(userId as string),
    enabled: userId !== null,
  });

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  const initials = currentUser
    ? `${currentUser.firstName.charAt(0)}${currentUser.lastName.charAt(0)}`.toUpperCase()
    : '';

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <Container className="flex h-16 items-center justify-between">
        <div className="flex items-center gap-4">
          <a href="/settings/organisation" aria-label="Zentuva home">
            <Logo />
          </a>
          {organisation && (
            <>
              <span className="hidden h-5 w-px bg-border sm:block" aria-hidden="true" />
              <span className="hidden text-sm font-medium text-muted-foreground sm:inline">
                {organisation.organisationName}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-4">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full bg-brandPurple text-xs font-semibold text-brandPurple-foreground"
            title={currentUser ? `${currentUser.firstName} ${currentUser.lastName}` : undefined}
            aria-hidden={!currentUser}
          >
            {initials}
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Logout
          </button>
        </div>
      </Container>
    </header>
  );
}
