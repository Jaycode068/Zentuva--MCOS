import type { UpdateOrganisationProfileInput } from '@zentuva/validation';

import { apiFetch } from '@/lib/api-client';

/** `GET /api/organisation/me` / `PATCH /api/organisation/me` response shape — see
 *  apps/api/src/identity/organisation/organisation.controller.ts. */
export interface OrganisationProfile {
  id: string;
  organisationCode: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
  organisationName: string;
  displayName: string | null;
  description: string | null;
  email: string;
  phoneNumber: string | null;
  website: string | null;
  country: string;
  state: string | null;
  city: string | null;
  addressLine: string | null;
  industry: string | null;
  currency: string;
  timezone: string;
}

export function getOrganisationProfile(): Promise<OrganisationProfile> {
  return apiFetch<OrganisationProfile>('/organisation/me');
}

export function updateOrganisationProfile(
  input: UpdateOrganisationProfileInput,
): Promise<OrganisationProfile> {
  return apiFetch<OrganisationProfile>('/organisation/me', {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}
