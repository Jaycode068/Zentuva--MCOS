import { ConflictException } from '@nestjs/common';
import { Organisation, User } from '@prisma/client';
import { RegisterOrganisationInput } from '@zentuva/validation';

import { UserService } from '../user/user.service';
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
    passwordHash: 'hashed',
    status: 'ACTIVE',
    failedLoginAttempts: 0,
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
    const service = new OrganisationService(organisationRepository, userService);
    return { service, organisationRepository, userService };
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
