import { ConflictException } from '@nestjs/common';
import { Organisation, User } from '@prisma/client';
import { RegisterOrganisationInput } from '@zentuva/validation';

import { UserService } from '../user/user.service';
import { FileStorage } from './ports/file-storage.port';
import { OrganisationRepository } from './organisation.repository';
import { OrganisationService } from './organisation.service';

describe('OrganisationService.register', () => {
  const organisation: Organisation = {
    id: 'org-1',
    name: 'Boby Bites Manufacturing',
    slug: 'boby-bites-manufacturing',
    organisationCode: 'BOB-0001',
    businessEmail: 'owner@bobybites.local',
    country: 'Nigeria',
    status: 'ACTIVE',
    displayName: null,
    logoUrl: null,
    darkLogoUrl: null,
    description: null,
    industry: null,
    businessType: null,
    phone: null,
    website: null,
    supportEmail: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    postalCode: null,
    currency: 'USD',
    timeZone: 'UTC',
    fiscalYearStart: 1,
    dateFormat: 'YYYY-MM-DD',
    timeFormat: 'HH:mm',
    numberFormat: '1,234.56',
    primaryColor: null,
    accentColor: null,
    registrationNumber: null,
    taxId: null,
    employeeCount: null,
    settings: {},
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  const owner: User = {
    id: 'user-1',
    organisationId: 'org-1',
    email: 'owner@bobybites.local',
    employeeCode: null,
    firstName: 'Boby',
    lastName: 'Owner',
    phoneNumber: null,
    avatarUrl: null,
    avatarKey: null,
    passwordHash: 'hashed',
    status: 'ACTIVE',
    failedLoginAttempts: 0,
    mustChangePassword: false,
    passwordChangedAt: null,
    emailVerifiedAt: new Date('2026-01-01'),
    lastLoginAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  const validInput: RegisterOrganisationInput = {
    organisationName: 'Boby Bites Manufacturing',
    country: 'Nigeria',
    firstName: 'Boby',
    lastName: 'Owner',
    email: 'owner@bobybites.local',
    password: 'SecurePass123!',
    confirmPassword: 'SecurePass123!',
    acceptTerms: true,
  };

  function makeService() {
    const organisationRepository = {
      existsByName: jest.fn().mockResolvedValue(false),
      existsBySlug: jest.fn().mockResolvedValue(false),
      existsByOrganisationCode: jest.fn().mockResolvedValue(false),
      registerTenant: jest.fn().mockResolvedValue({ organisation, owner }),
    } as unknown as OrganisationRepository;
    const userService = {
      existsByEmail: jest.fn().mockResolvedValue(false),
      hashPassword: jest.fn().mockResolvedValue('hashed-password'),
    } as unknown as UserService;
    const fileStorage = {
      upload: jest.fn(),
      delete: jest.fn(),
    } as unknown as FileStorage;
    const service = new OrganisationService(organisationRepository, userService, fileStorage);
    return { service, organisationRepository, userService, fileStorage };
  }

  it('rejects a duplicate organisation name with ConflictException', async () => {
    const { service, organisationRepository } = makeService();
    (organisationRepository.existsByName as jest.Mock).mockResolvedValue(true);

    await expect(service.register(validInput)).rejects.toThrow(ConflictException);
    expect(organisationRepository.registerTenant).not.toHaveBeenCalled();
  });

  it('rejects a duplicate owner email with ConflictException', async () => {
    const { service, userService, organisationRepository } = makeService();
    (userService.existsByEmail as jest.Mock).mockResolvedValue(true);

    await expect(service.register(validInput)).rejects.toThrow(ConflictException);
    expect(organisationRepository.registerTenant).not.toHaveBeenCalled();
  });

  it('generates a slug from the organisation name and appends a suffix on collision', async () => {
    const { service, organisationRepository } = makeService();
    (organisationRepository.existsBySlug as jest.Mock)
      .mockResolvedValueOnce(true) // "boby-bites-manufacturing" taken
      .mockResolvedValueOnce(false); // "boby-bites-manufacturing-2" free

    await service.register(validInput);

    expect(organisationRepository.registerTenant).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'boby-bites-manufacturing-2' }),
    );
  });

  it('generates an organisationCode from a letters-only prefix and a zero-padded sequence', async () => {
    const { service, organisationRepository } = makeService();

    await service.register(validInput);

    expect(organisationRepository.registerTenant).toHaveBeenCalledWith(
      expect.objectContaining({ organisationCode: 'BOB-0001' }),
    );
  });

  it('increments the organisationCode sequence on collision', async () => {
    const { service, organisationRepository } = makeService();
    (organisationRepository.existsByOrganisationCode as jest.Mock)
      .mockResolvedValueOnce(true) // BOB-0001 taken
      .mockResolvedValueOnce(false); // BOB-0002 free

    await service.register(validInput);

    expect(organisationRepository.registerTenant).toHaveBeenCalledWith(
      expect.objectContaining({ organisationCode: 'BOB-0002' }),
    );
  });

  it('hashes the password and defaults businessEmail to the owner email when not provided', async () => {
    const { service, organisationRepository, userService } = makeService();

    await service.register(validInput);

    expect(userService.hashPassword).toHaveBeenCalledWith('SecurePass123!');
    expect(organisationRepository.registerTenant).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerPasswordHash: 'hashed-password',
        businessEmail: 'owner@bobybites.local',
        ownerEmail: 'owner@bobybites.local',
        ownerFirstName: 'Boby',
        ownerLastName: 'Owner',
      }),
    );
  });

  it('uses the explicit businessEmail when provided instead of defaulting to the owner email', async () => {
    const { service, organisationRepository } = makeService();

    await service.register({ ...validInput, businessEmail: 'contact@bobybites.local' });

    expect(organisationRepository.registerTenant).toHaveBeenCalledWith(
      expect.objectContaining({ businessEmail: 'contact@bobybites.local' }),
    );
  });

  it('returns the created organisation and owner', async () => {
    const { service } = makeService();

    const result = await service.register(validInput);

    expect(result).toEqual({ organisation, owner });
  });
});

describe('OrganisationService — Workspace Configuration (Sprint 3.4)', () => {
  const baseOrganisation: Organisation = {
    id: 'org-1',
    name: 'Sahara Textiles Ltd',
    slug: 'sahara-textiles-ltd',
    organisationCode: 'SAH-0001',
    businessEmail: 'hello@saharatextiles.com',
    country: 'Nigeria',
    status: 'ACTIVE',
    displayName: null,
    logoUrl: null,
    darkLogoUrl: null,
    description: null,
    industry: null,
    businessType: null,
    phone: null,
    website: null,
    supportEmail: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    postalCode: null,
    currency: 'USD',
    timeZone: 'UTC',
    fiscalYearStart: 1,
    dateFormat: 'YYYY-MM-DD',
    timeFormat: 'HH:mm',
    numberFormat: '1,234.56',
    primaryColor: null,
    accentColor: null,
    registrationNumber: null,
    taxId: null,
    employeeCount: null,
    settings: {},
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  function makeWorkspaceService(overrides: Partial<Organisation> = {}) {
    const organisation = { ...baseOrganisation, ...overrides };
    const organisationRepository = {
      findById: jest.fn().mockResolvedValue(organisation),
      updateProfile: jest
        .fn()
        .mockImplementation((_id, data) => Promise.resolve({ ...organisation, ...data })),
    } as unknown as OrganisationRepository;
    const userService = {} as unknown as UserService;
    const fileStorage = {
      upload: jest
        .fn()
        .mockResolvedValue({ url: 'https://cdn.test/logos/new.png', key: 'logos/org-1/new.png' }),
      delete: jest.fn().mockResolvedValue(undefined),
    } as unknown as FileStorage;
    const service = new OrganisationService(organisationRepository, userService, fileStorage);
    return { service, organisationRepository, fileStorage, organisation };
  }

  describe('updateWorkspaceSettings', () => {
    it('passes plain column fields straight through', async () => {
      const { service, organisationRepository } = makeWorkspaceService();

      await service.updateWorkspaceSettings('org-1', { industry: 'Textiles', taxId: 'TIN-123' });

      expect(organisationRepository.updateProfile).toHaveBeenCalledWith('org-1', {
        industry: 'Textiles',
        taxId: 'TIN-123',
      });
    });

    it('merges a partial preferences update over the existing stored settings', async () => {
      const { service, organisationRepository } = makeWorkspaceService({
        settings: { theme: 'dark', preferences: { compactNavigation: true, aiFeatures: true } },
      });

      await service.updateWorkspaceSettings('org-1', { preferences: { aiFeatures: false } });

      expect(organisationRepository.updateProfile).toHaveBeenCalledWith('org-1', {
        settings: {
          theme: 'dark',
          preferences: expect.objectContaining({
            compactNavigation: true,
            aiFeatures: false,
            emailNotifications: true, // untouched default, not clobbered
          }),
        },
      });
    });

    it('defaults theme/preferences for an organisation with no settings stored yet', async () => {
      const { service, organisationRepository } = makeWorkspaceService({ settings: {} });

      await service.updateWorkspaceSettings('org-1', { theme: 'light' });

      expect(organisationRepository.updateProfile).toHaveBeenCalledWith('org-1', {
        settings: expect.objectContaining({
          theme: 'light',
          preferences: expect.objectContaining({ animationsEnabled: true }),
        }),
      });
    });
  });

  describe('setLogo', () => {
    it('uploads the file, stores the URL, and stashes the storage key in settings', async () => {
      const { service, organisationRepository, fileStorage } = makeWorkspaceService();

      await service.setLogo('org-1', 'light', { mimeType: 'image/png', buffer: Buffer.from('x') });

      expect(fileStorage.upload).toHaveBeenCalledWith({
        organisationId: 'org-1',
        folder: 'logos',
        mimeType: 'image/png',
        buffer: Buffer.from('x'),
      });
      expect(organisationRepository.updateProfile).toHaveBeenCalledWith('org-1', {
        logoUrl: 'https://cdn.test/logos/new.png',
        settings: { logoKey: 'logos/org-1/new.png' },
      });
    });

    it('deletes the previous file for that variant after a successful replacement', async () => {
      const { service, fileStorage } = makeWorkspaceService({
        logoUrl: 'https://cdn.test/logos/old.png',
        settings: { logoKey: 'logos/org-1/old.png' },
      });

      await service.setLogo('org-1', 'light', { mimeType: 'image/png', buffer: Buffer.from('x') });

      expect(fileStorage.delete).toHaveBeenCalledWith('logos/org-1/old.png');
    });

    it('stores dark and light logos under independent keys', async () => {
      const { service, organisationRepository } = makeWorkspaceService();

      await service.setLogo('org-1', 'dark', { mimeType: 'image/png', buffer: Buffer.from('x') });

      expect(organisationRepository.updateProfile).toHaveBeenCalledWith('org-1', {
        darkLogoUrl: 'https://cdn.test/logos/new.png',
        settings: { darkLogoKey: 'logos/org-1/new.png' },
      });
    });
  });

  describe('removeLogo', () => {
    it('clears the URL, removes the stored key, and deletes the file', async () => {
      const { service, organisationRepository, fileStorage } = makeWorkspaceService({
        logoUrl: 'https://cdn.test/logos/old.png',
        settings: { logoKey: 'logos/org-1/old.png', theme: 'dark' },
      });

      await service.removeLogo('org-1', 'light');

      expect(organisationRepository.updateProfile).toHaveBeenCalledWith('org-1', {
        logoUrl: null,
        settings: { theme: 'dark' },
      });
      expect(fileStorage.delete).toHaveBeenCalledWith('logos/org-1/old.png');
    });

    it('is a no-op delete when no logo was ever uploaded', async () => {
      const { service, fileStorage } = makeWorkspaceService();

      await service.removeLogo('org-1', 'light');

      expect(fileStorage.delete).not.toHaveBeenCalled();
    });
  });
});
