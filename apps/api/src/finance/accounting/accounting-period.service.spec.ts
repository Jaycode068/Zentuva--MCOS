import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AccountingPeriod, AccountingPeriodStatus } from '@prisma/client';

import { AccountingPeriodRepository } from './accounting-period.repository';
import { AccountingPeriodService } from './accounting-period.service';

describe('AccountingPeriodService', () => {
  const august: AccountingPeriod = {
    id: 'period-aug',
    organisationId: 'org-1',
    name: 'August 2026',
    startDate: new Date('2026-08-01'),
    endDate: new Date('2026-08-31'),
    status: AccountingPeriodStatus.OPEN,
    closedAt: null,
    closedById: null,
    createdById: 'user-1',
    createdAt: new Date('2026-08-01'),
    updatedAt: new Date('2026-08-01'),
  };

  function makeService() {
    const accountingPeriodRepository = {
      create: jest.fn(),
      findById: jest.fn(),
      findManyByOrganisation: jest.fn(),
      findAllByOrganisation: jest.fn().mockResolvedValue([]),
      findOpenPeriodForDate: jest.fn(),
      close: jest.fn(),
    } as unknown as jest.Mocked<AccountingPeriodRepository>;

    const service = new AccountingPeriodService(accountingPeriodRepository);
    return { service, accountingPeriodRepository };
  }

  describe('create', () => {
    it('creates a period as OPEN', async () => {
      const { service, accountingPeriodRepository } = makeService();
      accountingPeriodRepository.create.mockResolvedValue(august);

      await service.create(
        'org-1',
        { name: 'August 2026', startDate: new Date('2026-08-01'), endDate: new Date('2026-08-31') },
        'user-1',
      );

      expect(accountingPeriodRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: AccountingPeriodStatus.OPEN }),
      );
    });

    it.each([
      ['starts before and ends inside', new Date('2026-07-15'), new Date('2026-08-15')],
      ['starts inside and ends after', new Date('2026-08-15'), new Date('2026-09-15')],
      ['fully spans the existing period', new Date('2026-07-01'), new Date('2026-09-30')],
      ['fully inside the existing period', new Date('2026-08-10'), new Date('2026-08-20')],
      ['exactly matches the existing period', new Date('2026-08-01'), new Date('2026-08-31')],
    ])('rejects an overlapping range: %s', async (_label, startDate, endDate) => {
      const { service, accountingPeriodRepository } = makeService();
      accountingPeriodRepository.findAllByOrganisation.mockResolvedValue([august]);

      await expect(
        service.create('org-1', { name: 'Overlap', startDate, endDate }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a genuinely non-overlapping range', async () => {
      const { service, accountingPeriodRepository } = makeService();
      accountingPeriodRepository.findAllByOrganisation.mockResolvedValue([august]);
      accountingPeriodRepository.create.mockResolvedValue({
        ...august,
        id: 'period-jul',
        name: 'July 2026',
      });

      await service.create(
        'org-1',
        { name: 'July 2026', startDate: new Date('2026-07-01'), endDate: new Date('2026-07-31') },
        'user-1',
      );

      expect(accountingPeriodRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'July 2026' }),
      );
    });
  });

  describe('close', () => {
    it('closes an open period', async () => {
      const { service, accountingPeriodRepository } = makeService();
      accountingPeriodRepository.findById.mockResolvedValue(august);
      accountingPeriodRepository.close.mockResolvedValue({
        ...august,
        status: AccountingPeriodStatus.CLOSED,
      });

      const updated = await service.close('org-1', 'period-aug', 'user-1');
      expect(updated.status).toBe(AccountingPeriodStatus.CLOSED);
    });

    it('rejects closing an already-closed period', async () => {
      const { service, accountingPeriodRepository } = makeService();
      accountingPeriodRepository.findById.mockResolvedValue({
        ...august,
        status: AccountingPeriodStatus.CLOSED,
      });

      await expect(service.close('org-1', 'period-aug', 'user-1')).rejects.toThrow(
        'This period is already closed',
      );
    });

    it('throws NotFoundException for an unknown/cross-tenant period', async () => {
      const { service, accountingPeriodRepository } = makeService();
      accountingPeriodRepository.findById.mockResolvedValue(null);

      await expect(service.close('org-1', 'missing', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });
});
