import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { NETWORK_RELATIONSHIP_AUDIT_ACTIONS } from './network-relationship-audit-actions';
import { NetworkRelationshipController } from './network-relationship.controller';
import { NetworkRelationshipWithCustomers } from './network-relationship.repository';
import { NetworkRelationshipService } from './network-relationship.service';

describe('NetworkRelationshipController', () => {
  const tokenUser: TokenPayload = {
    sub: 'user-1',
    organisationId: 'org-1',
    sessionId: 'session-1',
  };

  const relationship: NetworkRelationshipWithCustomers = {
    id: 'relationship-1',
    organisationId: 'org-1',
    sourceCustomerId: 'source-1',
    targetCustomerId: 'target-1',
    relationshipType: 'DISTRIBUTES_TO',
    effectiveFrom: new Date('2026-08-21'),
    effectiveTo: null,
    status: 'ACTIVE',
    notes: null,
    createdById: 'user-1',
    updatedById: 'user-1',
    createdAt: new Date('2026-08-21'),
    updatedAt: new Date('2026-08-21'),
    sourceCustomer: {
      id: 'source-1',
      customerCode: 'CUS-000001',
      customerName: 'Distributor X',
      customerType: 'DISTRIBUTOR',
    },
    targetCustomer: {
      id: 'target-1',
      customerCode: 'CUS-000002',
      customerName: 'Retailer A',
      customerType: 'RETAILER',
    },
  };

  function makeController() {
    const networkRelationshipService = {
      list: jest.fn(),
      getById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deactivate: jest.fn(),
    } as unknown as jest.Mocked<NetworkRelationshipService>;
    const auditService = { record: jest.fn() } as unknown as jest.Mocked<AuditService>;

    const controller = new NetworkRelationshipController(networkRelationshipService, auditService);
    return { controller, networkRelationshipService, auditService };
  }

  const req = { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } } as unknown as Request;

  describe('create', () => {
    it('creates the relationship and records an audit entry', async () => {
      const { controller, networkRelationshipService, auditService } = makeController();
      networkRelationshipService.create.mockResolvedValue(relationship);

      await controller.create(
        {
          sourceCustomerId: 'source-1',
          targetCustomerId: 'target-1',
          relationshipType: 'DISTRIBUTES_TO',
        },
        tokenUser,
        req,
      );

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: NETWORK_RELATIONSHIP_AUDIT_ACTIONS.CREATED,
          entityId: 'relationship-1',
        }),
      );
    });
  });

  describe('update', () => {
    it('updates the relationship and records an audit entry', async () => {
      const { controller, networkRelationshipService, auditService } = makeController();
      networkRelationshipService.update.mockResolvedValue({ ...relationship, notes: 'Updated' });

      await controller.update('relationship-1', { notes: 'Updated' }, tokenUser, req);

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: NETWORK_RELATIONSHIP_AUDIT_ACTIONS.UPDATED }),
      );
    });
  });

  describe('deactivate', () => {
    it('deactivates and records an audit entry', async () => {
      const { controller, networkRelationshipService, auditService } = makeController();
      networkRelationshipService.deactivate.mockResolvedValue({
        ...relationship,
        status: 'INACTIVE',
      });

      await controller.deactivate('relationship-1', tokenUser, req);

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: NETWORK_RELATIONSHIP_AUDIT_ACTIONS.DEACTIVATED }),
      );
    });
  });
});
