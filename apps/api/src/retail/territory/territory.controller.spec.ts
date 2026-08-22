import { NotFoundException } from '@nestjs/common';
import { Territory, TerritoryStatus } from '@prisma/client';
import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { TERRITORY_AUDIT_ACTIONS } from './territory-audit-actions';
import { TerritoryController } from './territory.controller';
import { TerritoryService } from './territory.service';

describe('TerritoryController', () => {
  const tokenUser: TokenPayload = {
    sub: 'user-1',
    organisationId: 'org-1',
    sessionId: 'session-1',
  };

  const territory: Territory = {
    id: 'territory-1',
    organisationId: 'org-1',
    territoryCode: 'TER-000001',
    name: 'Oyo State',
    type: 'State',
    parentTerritoryId: null,
    status: TerritoryStatus.ACTIVE,
    description: null,
    createdById: 'user-1',
    updatedById: 'user-1',
    createdAt: new Date('2026-08-21'),
    updatedAt: new Date('2026-08-21'),
  };

  function makeController() {
    const territoryService = {
      list: jest.fn(),
      getById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      activate: jest.fn(),
      deactivate: jest.fn(),
    } as unknown as jest.Mocked<TerritoryService>;
    const auditService = { record: jest.fn() } as unknown as jest.Mocked<AuditService>;

    const controller = new TerritoryController(territoryService, auditService);
    return { controller, territoryService, auditService };
  }

  const req = { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } } as unknown as Request;

  describe('list', () => {
    it('passes filters through', async () => {
      const { controller, territoryService } = makeController();
      territoryService.list.mockResolvedValue([territory]);

      await controller.list(tokenUser, 'ACTIVE', 'parent-1', '  oyo  ');

      expect(territoryService.list).toHaveBeenCalledWith('org-1', {
        status: 'ACTIVE',
        parentTerritoryId: 'parent-1',
        search: 'oyo',
      });
    });
  });

  describe('getOne', () => {
    it('throws NotFoundException for a missing territory', async () => {
      const { controller, territoryService } = makeController();
      territoryService.getById.mockResolvedValue(null);

      await expect(controller.getOne(tokenUser, 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates the territory and records an audit entry', async () => {
      const { controller, territoryService, auditService } = makeController();
      territoryService.create.mockResolvedValue(territory);

      const result = await controller.create({ name: 'Oyo State', type: 'State' }, tokenUser, req);

      expect(territoryService.create).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({ name: 'Oyo State' }),
        'user-1',
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: TERRITORY_AUDIT_ACTIONS.CREATED,
          entityId: 'territory-1',
        }),
      );
      expect(result.territoryCode).toBe('TER-000001');
    });
  });

  describe('update', () => {
    it('updates the territory and records an audit entry', async () => {
      const { controller, territoryService, auditService } = makeController();
      territoryService.update.mockResolvedValue({ ...territory, name: 'Updated' });

      await controller.update('territory-1', { name: 'Updated' }, tokenUser, req);

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: TERRITORY_AUDIT_ACTIONS.UPDATED }),
      );
    });
  });

  describe('activate / deactivate', () => {
    it('activates and records an audit entry', async () => {
      const { controller, territoryService, auditService } = makeController();
      territoryService.activate.mockResolvedValue(territory);

      await controller.activate('territory-1', tokenUser, req);

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: TERRITORY_AUDIT_ACTIONS.ACTIVATED }),
      );
    });

    it('deactivates and records an audit entry', async () => {
      const { controller, territoryService, auditService } = makeController();
      territoryService.deactivate.mockResolvedValue({
        ...territory,
        status: TerritoryStatus.INACTIVE,
      });

      await controller.deactivate('territory-1', tokenUser, req);

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: TERRITORY_AUDIT_ACTIONS.DEACTIVATED }),
      );
    });
  });
});
