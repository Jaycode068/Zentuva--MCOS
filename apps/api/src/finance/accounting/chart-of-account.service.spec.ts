import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AccountType, ChartOfAccount } from '@prisma/client';

import { ChartOfAccountRepository } from './chart-of-account.repository';
import { ChartOfAccountService } from './chart-of-account.service';

describe('ChartOfAccountService', () => {
  const account: ChartOfAccount = {
    id: 'account-1',
    organisationId: 'org-1',
    code: '1200',
    name: 'Accounts Receivable',
    type: AccountType.ASSET,
    parentId: null,
    description: null,
    isActive: true,
    isSystemAccount: false,
    systemKey: null,
    createdById: 'user-1',
    updatedById: 'user-1',
    createdAt: new Date('2026-08-24'),
    updatedAt: new Date('2026-08-24'),
  };

  function makeService() {
    const chartOfAccountRepository = {
      create: jest.fn(),
      findById: jest.fn(),
      findManyByOrganisation: jest.fn(),
      existsByCode: jest.fn().mockResolvedValue(false),
      findBySystemKey: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<ChartOfAccountRepository>;

    const service = new ChartOfAccountService(chartOfAccountRepository);
    return { service, chartOfAccountRepository };
  }

  describe('create', () => {
    it('creates an account', async () => {
      const { service, chartOfAccountRepository } = makeService();
      chartOfAccountRepository.create.mockResolvedValue(account);

      await service.create(
        'org-1',
        { code: '1200', name: 'Accounts Receivable', type: AccountType.ASSET },
        'user-1',
      );

      expect(chartOfAccountRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          code: '1200',
          name: 'Accounts Receivable',
          type: AccountType.ASSET,
        }),
      );
    });

    it('rejects a duplicate code within the same organisation', async () => {
      const { service, chartOfAccountRepository } = makeService();
      chartOfAccountRepository.existsByCode.mockResolvedValue(true);

      await expect(
        service.create('org-1', { code: '1200', name: 'Dup', type: AccountType.ASSET }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a parent account that does not exist in this organisation', async () => {
      const { service, chartOfAccountRepository } = makeService();
      chartOfAccountRepository.findById.mockResolvedValue(null);

      await expect(
        service.create(
          'org-1',
          { code: '1210', name: 'Trade Receivables', type: AccountType.ASSET, parentId: 'missing' },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a real parent account and connects it', async () => {
      const { service, chartOfAccountRepository } = makeService();
      chartOfAccountRepository.findById.mockResolvedValue(account);
      chartOfAccountRepository.create.mockResolvedValue({ ...account, parentId: 'account-1' });

      await service.create(
        'org-1',
        { code: '1210', name: 'Trade Receivables', type: AccountType.ASSET, parentId: 'account-1' },
        'user-1',
      );

      expect(chartOfAccountRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ parent: { connect: { id: 'account-1' } } }),
      );
    });
  });

  describe('update', () => {
    it('updates name/description', async () => {
      const { service, chartOfAccountRepository } = makeService();
      chartOfAccountRepository.findById.mockResolvedValue(account);
      chartOfAccountRepository.update.mockResolvedValue({ ...account, name: 'Renamed' });

      const updated = await service.update('org-1', 'account-1', { name: 'Renamed' }, 'user-1');
      expect(updated.name).toBe('Renamed');
    });

    it('rejects an account being its own parent', async () => {
      const { service, chartOfAccountRepository } = makeService();
      chartOfAccountRepository.findById.mockResolvedValue(account);

      await expect(
        service.update('org-1', 'account-1', { parentId: 'account-1' }, 'user-1'),
      ).rejects.toThrow('An account cannot be its own parent');
    });

    it('rejects re-parenting to one of its own descendants (cycle)', async () => {
      const { service, chartOfAccountRepository } = makeService();
      const child = { ...account, id: 'account-2', parentId: 'account-1' };
      chartOfAccountRepository.findById.mockImplementation(async (_org, id) => {
        if (id === 'account-1') return account;
        if (id === 'account-2') return child;
        return null;
      });

      // account-1's proposed new parent is account-2, but account-2's own parent is
      // account-1 — re-parenting account-1 under account-2 would form a cycle.
      await expect(
        service.update('org-1', 'account-1', { parentId: 'account-2' }, 'user-1'),
      ).rejects.toThrow('Cannot re-parent an account to one of its own descendants');
    });

    it('throws NotFoundException for an unknown account', async () => {
      const { service, chartOfAccountRepository } = makeService();
      chartOfAccountRepository.findById.mockResolvedValue(null);

      await expect(service.update('org-1', 'missing', { name: 'X' }, 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deactivate', () => {
    it('deactivates a regular account', async () => {
      const { service, chartOfAccountRepository } = makeService();
      chartOfAccountRepository.findById.mockResolvedValue(account);
      chartOfAccountRepository.update.mockResolvedValue({ ...account, isActive: false });

      const updated = await service.deactivate('org-1', 'account-1', 'user-1');
      expect(updated.isActive).toBe(false);
    });

    it('refuses to deactivate a system account', async () => {
      const { service, chartOfAccountRepository } = makeService();
      chartOfAccountRepository.findById.mockResolvedValue({ ...account, isSystemAccount: true });

      await expect(service.deactivate('org-1', 'account-1', 'user-1')).rejects.toThrow(
        'A system account cannot be deactivated',
      );
    });

    it('rejects deactivating an already-inactive account', async () => {
      const { service, chartOfAccountRepository } = makeService();
      chartOfAccountRepository.findById.mockResolvedValue({ ...account, isActive: false });

      await expect(service.deactivate('org-1', 'account-1', 'user-1')).rejects.toThrow(
        'Account is already inactive',
      );
    });
  });

  describe('activate', () => {
    it('activates an inactive account', async () => {
      const { service, chartOfAccountRepository } = makeService();
      chartOfAccountRepository.findById.mockResolvedValue({ ...account, isActive: false });
      chartOfAccountRepository.update.mockResolvedValue(account);

      const updated = await service.activate('org-1', 'account-1', 'user-1');
      expect(updated.isActive).toBe(true);
    });

    it('rejects activating an already-active account', async () => {
      const { service, chartOfAccountRepository } = makeService();
      chartOfAccountRepository.findById.mockResolvedValue(account);

      await expect(service.activate('org-1', 'account-1', 'user-1')).rejects.toThrow(
        'Account is already active',
      );
    });
  });

  describe('tenant isolation', () => {
    it('getById 404s when the repository finds nothing for this organisation', async () => {
      const { service, chartOfAccountRepository } = makeService();
      chartOfAccountRepository.findById.mockResolvedValue(null);

      await expect(service.getById('org-1', 'account-1')).rejects.toThrow(NotFoundException);
    });
  });
});
