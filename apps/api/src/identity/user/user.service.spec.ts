import { ConflictException, NotFoundException } from '@nestjs/common';
import { Role, UserStatus } from '@prisma/client';

import { PasswordHasher } from '../crypto/password-hasher.port';
import { FileStorage } from '../organisation/ports/file-storage.port';
import { RoleService } from '../role/role.service';
import { UserRepository, UserWithRoles } from './user.repository';
import { UserService } from './user.service';

describe('UserService', () => {
  const role: Role = {
    id: 'role-admin',
    organisationId: 'org-1',
    name: 'Administrator',
    description: null,
    isSystem: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  const user: UserWithRoles = {
    id: 'user-1',
    organisationId: 'org-1',
    email: 'jane@bobybites.local',
    employeeCode: null,
    firstName: 'Jane',
    lastName: 'Doe',
    phoneNumber: null,
    avatarUrl: null,
    avatarKey: null,
    passwordHash: 'hashed',
    status: UserStatus.ACTIVE,
    failedLoginAttempts: 0,
    mustChangePassword: false,
    passwordChangedAt: null,
    emailVerifiedAt: new Date('2026-01-01'),
    lastLoginAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
    userRoles: [],
  };

  function makeService() {
    const userRepository = {
      existsByEmail: jest.fn(),
      createWithRole: jest.fn(),
      findById: jest.fn(),
      findByIdWithRoles: jest.fn(),
      updateProfile: jest.fn(),
      updateStatus: jest.fn(),
    } as unknown as jest.Mocked<UserRepository>;
    const roleService = {
      getByName: jest.fn(),
      replaceUserRole: jest.fn(),
    } as unknown as RoleService;
    const passwordHasher = { hash: jest.fn(), compare: jest.fn() } as unknown as PasswordHasher;
    const fileStorage = {
      upload: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<FileStorage>;
    const service = new UserService(userRepository, roleService, passwordHasher, fileStorage);
    return { service, userRepository, roleService, passwordHasher, fileStorage };
  }

  describe('createUser', () => {
    it('rejects a duplicate email with ConflictException', async () => {
      const { service, userRepository } = makeService();
      (userRepository.existsByEmail as jest.Mock).mockResolvedValue(true);

      await expect(
        service.createUser('org-1', {
          firstName: 'Jane',
          lastName: 'Doe',
          email: 'jane@bobybites.local',
          role: 'Administrator',
          temporaryPassword: 'temp12345',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects an unknown role with NotFoundException', async () => {
      const { service, userRepository, roleService } = makeService();
      (userRepository.existsByEmail as jest.Mock).mockResolvedValue(false);
      (roleService.getByName as jest.Mock).mockResolvedValue(null);

      await expect(
        service.createUser('org-1', {
          firstName: 'Jane',
          lastName: 'Doe',
          email: 'jane@bobybites.local',
          role: 'Administrator',
          temporaryPassword: 'temp12345',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('hashes the temporary password and creates the user as ACTIVE with the resolved role', async () => {
      const { service, userRepository, roleService, passwordHasher } = makeService();
      (userRepository.existsByEmail as jest.Mock).mockResolvedValue(false);
      (roleService.getByName as jest.Mock).mockResolvedValue(role);
      (passwordHasher.hash as jest.Mock).mockResolvedValue('hashed-temp-password');
      (userRepository.createWithRole as jest.Mock).mockResolvedValue(user);

      const result = await service.createUser('org-1', {
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@bobybites.local',
        role: 'Administrator',
        temporaryPassword: 'temp12345',
      });

      expect(passwordHasher.hash).toHaveBeenCalledWith('temp12345');
      expect(userRepository.createWithRole).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'jane@bobybites.local',
          passwordHash: 'hashed-temp-password',
          status: UserStatus.ACTIVE,
        }),
        'org-1',
        'role-admin',
      );
      expect(result).toBe(user);
    });
  });

  describe('updateUser', () => {
    it('throws NotFoundException when the user does not exist in this organisation', async () => {
      const { service, userRepository } = makeService();
      (userRepository.findByIdWithRoles as jest.Mock).mockResolvedValue(null);

      await expect(service.updateUser('org-1', 'missing', { firstName: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('maps wire status INACTIVE to the DB SUSPENDED status', async () => {
      const { service, userRepository } = makeService();
      (userRepository.findByIdWithRoles as jest.Mock).mockResolvedValue(user);

      await service.updateUser('org-1', 'user-1', { status: 'INACTIVE' });

      expect(userRepository.updateStatus).toHaveBeenCalledWith(
        'org-1',
        'user-1',
        UserStatus.SUSPENDED,
      );
    });

    it('resolves and replaces the role when role is provided', async () => {
      const { service, userRepository, roleService } = makeService();
      (userRepository.findByIdWithRoles as jest.Mock).mockResolvedValue(user);
      (roleService.getByName as jest.Mock).mockResolvedValue(role);

      await service.updateUser('org-1', 'user-1', { role: 'Administrator' });

      expect(roleService.getByName).toHaveBeenCalledWith('org-1', 'Administrator');
      expect(roleService.replaceUserRole).toHaveBeenCalledWith('org-1', 'user-1', 'role-admin');
    });

    it('only updates profile fields when only profile fields are provided', async () => {
      const { service, userRepository, roleService } = makeService();
      (userRepository.findByIdWithRoles as jest.Mock).mockResolvedValue(user);

      await service.updateUser('org-1', 'user-1', { firstName: 'Janet' });

      expect(userRepository.updateProfile).toHaveBeenCalledWith('org-1', 'user-1', {
        firstName: 'Janet',
        lastName: undefined,
        employeeCode: undefined,
      });
      expect(userRepository.updateStatus).not.toHaveBeenCalled();
      expect(roleService.replaceUserRole).not.toHaveBeenCalled();
    });
  });

  describe('setAvatar', () => {
    it('uploads the file, stores the URL, and stashes the storage key', async () => {
      const { service, userRepository, fileStorage } = makeService();
      userRepository.findById.mockResolvedValue(user);
      fileStorage.upload.mockResolvedValue({
        url: 'https://cdn.test/avatars/new.png',
        key: 'avatars/org-1/new.png',
      });

      await service.setAvatar('org-1', 'user-1', {
        mimeType: 'image/png',
        buffer: Buffer.from('x'),
      });

      expect(fileStorage.upload).toHaveBeenCalledWith({
        organisationId: 'org-1',
        folder: 'avatars',
        mimeType: 'image/png',
        buffer: Buffer.from('x'),
      });
      expect(userRepository.updateProfile).toHaveBeenCalledWith('org-1', 'user-1', {
        avatarUrl: 'https://cdn.test/avatars/new.png',
        avatarKey: 'avatars/org-1/new.png',
      });
    });

    it('deletes the previous avatar file after a successful replacement', async () => {
      const { service, userRepository, fileStorage } = makeService();
      userRepository.findById.mockResolvedValue({
        ...user,
        avatarUrl: 'https://cdn.test/avatars/old.png',
        avatarKey: 'avatars/org-1/old.png',
      });
      fileStorage.upload.mockResolvedValue({
        url: 'https://cdn.test/avatars/new.png',
        key: 'avatars/org-1/new.png',
      });

      await service.setAvatar('org-1', 'user-1', {
        mimeType: 'image/png',
        buffer: Buffer.from('x'),
      });

      expect(fileStorage.delete).toHaveBeenCalledWith('avatars/org-1/old.png');
    });

    it('throws NotFoundException when the user no longer exists', async () => {
      const { service, userRepository } = makeService();
      userRepository.findById.mockResolvedValue(null);

      await expect(
        service.setAvatar('org-1', 'missing', { mimeType: 'image/png', buffer: Buffer.from('x') }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('removeAvatar', () => {
    it('clears the URL/key and deletes the file', async () => {
      const { service, userRepository, fileStorage } = makeService();
      userRepository.findById.mockResolvedValue({
        ...user,
        avatarUrl: 'https://cdn.test/avatars/old.png',
        avatarKey: 'avatars/org-1/old.png',
      });

      await service.removeAvatar('org-1', 'user-1');

      expect(userRepository.updateProfile).toHaveBeenCalledWith('org-1', 'user-1', {
        avatarUrl: null,
        avatarKey: null,
      });
      expect(fileStorage.delete).toHaveBeenCalledWith('avatars/org-1/old.png');
    });

    it('is a no-op delete when no avatar was ever uploaded', async () => {
      const { service, userRepository, fileStorage } = makeService();
      userRepository.findById.mockResolvedValue(user);

      await service.removeAvatar('org-1', 'user-1');

      expect(fileStorage.delete).not.toHaveBeenCalled();
    });
  });
});
