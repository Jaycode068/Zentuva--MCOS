import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Organisation, Prisma } from '@prisma/client';
import { RegisterOrganisationInput } from '@zentuva/validation';

import { UserService } from '../user/user.service';
import { FILE_STORAGE, FileStorage } from './ports/file-storage.port';
import { OrganisationRepository, RegisterTenantResult } from './organisation.repository';
import {
  getLogoStorageKey,
  mergeWorkspaceSettings,
  withLogoStorageKey,
  WorkspacePreferences,
  WorkspaceTheme,
} from './workspace-settings';

/**
 * Domain service for the Organisation aggregate.
 *
 * Sprint 1B.1 scope note: methods that are pure reads or plain data mutations with no
 * authentication/authorization concerns are implemented for real (delegating to the
 * repository). `register` spans multiple aggregates and requires password hashing —
 * that's authentication-adjacent and explicitly out of scope this sprint, so it's a
 * signature-only stub. See docs/sprint-1B.1-completion-report.md.
 *
 * Sprint 3.2 implements `register` for real (see below).
 */
@Injectable()
export class OrganisationService {
  constructor(
    private readonly organisationRepository: OrganisationRepository,
    private readonly userService: UserService,
    @Inject(FILE_STORAGE) private readonly fileStorage: FileStorage,
  ) {}

  getById(id: string): Promise<Organisation | null> {
    return this.organisationRepository.findById(id);
  }

  getBySlug(slug: string): Promise<Organisation | null> {
    return this.organisationRepository.findBySlug(slug);
  }

  updateProfile(id: string, input: UpdateOrganisationProfileInput): Promise<Organisation> {
    return this.organisationRepository.updateProfile(id, input);
  }

  suspend(id: string): Promise<Organisation> {
    return this.organisationRepository.updateStatus(id, 'SUSPENDED');
  }

  reactivate(id: string): Promise<Organisation> {
    return this.organisationRepository.updateStatus(id, 'ACTIVE');
  }

  close(id: string): Promise<Organisation> {
    return this.organisationRepository.updateStatus(id, 'CLOSED');
  }

  /**
   * Self-service Organisation Registration (identity.md §3/§5/§11), implemented Sprint
   * 3.2: validates the organisation name and owner email are both free, generates a
   * unique slug and organisationCode, hashes the password (reusing
   * `UserService.hashPassword`, i.e. the same `PasswordHasher` port everything else
   * uses), and delegates the actual atomic write to
   * {@link OrganisationRepository.registerTenant}.
   *
   * Deliberately does **not** issue a session/tokens — unlike identity.md's original
   * "...and issues a session" design, this sprint's brief has the browser flow land on
   * a "Registration Successful" screen and then redirect to `/login`, not straight into
   * an authenticated session. See docs/sprint-3.2-completion-report.md "Deviations from
   * Design."
   */
  async register(input: RegisterOrganisationInput): Promise<RegisterTenantResult> {
    const nameTaken = await this.organisationRepository.existsByName(input.organisationName);
    if (nameTaken) {
      throw new ConflictException(`Organisation name "${input.organisationName}" is already taken`);
    }

    const emailTaken = await this.userService.existsByEmail(input.email);
    if (emailTaken) {
      throw new ConflictException(`Email "${input.email}" is already in use`);
    }

    const slug = await this.generateUniqueSlug(input.organisationName);
    const organisationCode = await this.generateUniqueOrganisationCode(input.organisationName);
    const ownerPasswordHash = await this.userService.hashPassword(input.password);

    return this.organisationRepository.registerTenant({
      name: input.organisationName,
      displayName: input.displayName,
      industry: input.industry,
      country: input.country,
      state: input.state,
      city: input.city,
      phone: input.phoneNumber,
      businessEmail: input.businessEmail ?? input.email,
      website: input.website,
      slug,
      organisationCode,
      ownerFirstName: input.firstName,
      ownerLastName: input.lastName,
      ownerEmail: input.email,
      ownerPasswordHash,
    });
  }

  // ---------------------------------------------------------------------------------
  // Workspace Configuration (Sprint 3.4 brief)
  // ---------------------------------------------------------------------------------

  /**
   * `PATCH /api/settings/workspace`. `columnFields` are plain `Organisation` columns —
   * passed straight through to {@link OrganisationRepository.updateProfile}, exactly like
   * `updateProfile` above (Sprint 2.1). `theme`/`preferences`, when present, are merged
   * into the existing `settings` JSON (read-modify-write, since a partial preferences
   * update must not clobber the preferences it didn't mention) rather than overwritten.
   */
  async updateWorkspaceSettings(
    id: string,
    input: UpdateWorkspaceSettingsPatch,
  ): Promise<Organisation> {
    const { theme, preferences, ...columnFields } = input;
    const data: Prisma.OrganisationUpdateInput = { ...columnFields };

    if (theme !== undefined || preferences !== undefined) {
      const current = await this.getByIdOrThrow(id);
      const merged = mergeWorkspaceSettings(current.settings);
      const next = {
        theme: theme ?? merged.theme,
        preferences: { ...merged.preferences, ...(preferences ?? {}) },
      };
      data.settings = next as unknown as Prisma.InputJsonValue;
    }

    return this.organisationRepository.updateProfile(id, data);
  }

  /**
   * `POST /api/settings/logo?variant=light|dark`. Uploads via the injected
   * {@link FileStorage} port (never touches the filesystem directly), stores the
   * resulting URL on `logoUrl`/`darkLogoUrl`, and stashes the storage key in `settings`
   * (see `getLogoStorageKey`/`withLogoStorageKey`) so a previously-uploaded file can be
   * cleaned up. Deleting the old file is best-effort — if it fails (already gone, adapter
   * hiccup), the new logo is still saved; an orphaned file is a harmless MVP trade-off,
   * not a correctness issue.
   */
  async setLogo(
    id: string,
    variant: 'light' | 'dark',
    file: { mimeType: string; buffer: Buffer },
  ): Promise<Organisation> {
    const organisation = await this.getByIdOrThrow(id);
    const previousKey = getLogoStorageKey(organisation.settings, variant);

    const uploaded = await this.fileStorage.upload({
      organisationId: id,
      folder: 'logos',
      mimeType: file.mimeType,
      buffer: file.buffer,
    });

    const urlField = variant === 'dark' ? 'darkLogoUrl' : 'logoUrl';
    const nextSettings = withLogoStorageKey(organisation.settings, variant, uploaded.key);
    const updated = await this.organisationRepository.updateProfile(id, {
      [urlField]: uploaded.url,
      settings: nextSettings as Prisma.InputJsonValue,
    });

    if (previousKey) {
      await this.fileStorage.delete(previousKey).catch(() => undefined);
    }
    return updated;
  }

  /** `DELETE /api/settings/logo?variant=light|dark`. */
  async removeLogo(id: string, variant: 'light' | 'dark'): Promise<Organisation> {
    const organisation = await this.getByIdOrThrow(id);
    const key = getLogoStorageKey(organisation.settings, variant);

    const urlField = variant === 'dark' ? 'darkLogoUrl' : 'logoUrl';
    const nextSettings = withLogoStorageKey(organisation.settings, variant, undefined);
    const updated = await this.organisationRepository.updateProfile(id, {
      [urlField]: null,
      settings: nextSettings as Prisma.InputJsonValue,
    });

    if (key) {
      await this.fileStorage.delete(key).catch(() => undefined);
    }
    return updated;
  }

  private async getByIdOrThrow(id: string): Promise<Organisation> {
    const organisation = await this.organisationRepository.findById(id);
    if (!organisation) {
      throw new NotFoundException('Organisation not found');
    }
    return organisation;
  }

  private async generateUniqueSlug(name: string): Promise<string> {
    const base = slugify(name);
    let candidate = base;
    let suffix = 1;
    while (await this.organisationRepository.existsBySlug(candidate)) {
      suffix += 1;
      candidate = `${base}-${suffix}`;
    }
    return candidate;
  }

  private async generateUniqueOrganisationCode(name: string): Promise<string> {
    const prefix = derivePrefix(name);
    let sequence = 1;
    let candidate = formatOrganisationCode(prefix, sequence);
    while (await this.organisationRepository.existsByOrganisationCode(candidate)) {
      sequence += 1;
      candidate = formatOrganisationCode(prefix, sequence);
    }
    return candidate;
  }
}

/** identity.md §3 "Organisation Code": "a short prefix ... plus a zero-padded sequence
 *  number." This is the Sprint 3.2 implementation of that previously-undecided detail. */
function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'organisation';
}

function derivePrefix(value: string): string {
  const letters = value.replace(/[^a-zA-Z]/g, '').toUpperCase();
  return letters.slice(0, 3) || 'ZEN';
}

function formatOrganisationCode(prefix: string, sequence: number): string {
  return `${prefix}-${String(sequence).padStart(4, '0')}`;
}

/**
 * Domain-layer shape (Prisma column names) for a profile update — see
 * {@link OrganisationController} for the mapping from the wire-level DTO
 * (`updateOrganisationProfileSchema`, which uses `organisationName`/`phoneNumber`/
 * `addressLine`/`timezone`) to this shape. Sprint 2.1 MVP fields only — see
 * docs/sprint-2.1-completion-report.md.
 */
export interface UpdateOrganisationProfileInput {
  name?: string;
  displayName?: string;
  description?: string;
  businessEmail?: string;
  phone?: string;
  website?: string;
  country?: string;
  state?: string;
  city?: string;
  addressLine1?: string;
  industry?: string;
  currency?: string;
  timeZone?: string;
}

/**
 * Domain-layer shape for `PATCH /api/settings/workspace` (Sprint 3.4) — extends
 * {@link UpdateOrganisationProfileInput} with the plain-column Regional/Branding/
 * Business fields, plus `theme`/`preferences` (merged into the `settings` JSON column by
 * {@link OrganisationService.updateWorkspaceSettings}, not passed straight through like
 * the rest). See {@link SettingsController} for the wire-to-domain field mapping.
 */
export interface UpdateWorkspaceSettingsPatch extends UpdateOrganisationProfileInput {
  timeFormat?: string;
  numberFormat?: string;
  fiscalYearStart?: number;
  businessType?: string;
  registrationNumber?: string;
  taxId?: string;
  employeeCount?: string;
  primaryColor?: string;
  accentColor?: string;
  theme?: WorkspaceTheme;
  preferences?: Partial<WorkspacePreferences>;
}
