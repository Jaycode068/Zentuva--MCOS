import type { UpdateWorkspaceSettingsInput } from '@zentuva/validation';

import { ApiError, apiFetch, getAccessToken } from './api-client';
import { env } from './env';

/** `GET/PATCH /api/settings/workspace` response — see
 *  apps/api/src/identity/settings/settings.controller.ts (`toWorkspaceSettingsResponse`). */
export interface WorkspaceSettings {
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

  logoUrl: string | null;
  darkLogoUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  theme: 'light' | 'dark' | 'system';

  country: string;
  state: string | null;
  city: string | null;
  addressLine: string | null;
  currency: string;
  timezone: string;
  dateFormat: string;
  timeFormat: string;
  numberFormat: string;
  fiscalYearStart: number;

  industry: string | null;
  manufacturingSector: string | null;
  registrationNumber: string | null;
  taxId: string | null;
  employeeCount: string | null;

  preferences: {
    defaultLandingPage: 'organisation' | 'users';
    compactNavigation: boolean;
    animationsEnabled: boolean;
    emailNotifications: boolean;
    systemNotifications: boolean;
    marketingEmails: boolean;
    aiFeatures: boolean;
    experimentalFeatures: boolean;
  };
}

export function getWorkspaceSettings(): Promise<WorkspaceSettings> {
  return apiFetch<WorkspaceSettings>('/settings/workspace');
}

export function updateWorkspaceSettings(
  input: Partial<UpdateWorkspaceSettingsInput>,
): Promise<WorkspaceSettings> {
  return apiFetch<WorkspaceSettings>('/settings/workspace', {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/** `POST /api/settings/logo?variant=light|dark` — multipart upload, so this bypasses
 *  `apiFetch`'s JSON `Content-Type` header (the browser sets the correct multipart
 *  boundary itself when given a `FormData` body). */
export async function uploadLogo(
  file: File,
  variant: 'light' | 'dark',
): Promise<WorkspaceSettings> {
  const formData = new FormData();
  formData.append('file', file);

  const token = getAccessToken();
  const response = await fetch(`${env.NEXT_PUBLIC_API_URL}/settings/logo?variant=${variant}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: formData,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => undefined);
    throw new ApiError(response.status, body?.message ?? response.statusText, body);
  }
  return (await response.json()) as WorkspaceSettings;
}

export function deleteLogo(variant: 'light' | 'dark'): Promise<WorkspaceSettings> {
  return apiFetch<WorkspaceSettings>(`/settings/logo?variant=${variant}`, {
    method: 'DELETE',
  });
}
