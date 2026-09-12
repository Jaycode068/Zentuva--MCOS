import { BadRequestException, NotFoundException } from '@nestjs/common';

import { PositionService } from './position.service';

const ORG = 'org-1';
const OTHER_ORG = 'org-2';

function makePosition(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'pos-1',
    organisationId: ORG,
    code: 'PM',
    title: 'Production Manager',
    departmentId: null,
    reportsToPositionId: null,
    status: 'ACTIVE',
    ...overrides,
  };
}

function makeService(options?: {
  positions?: Record<string, Record<string, unknown>>;
  departments?: Record<string, Record<string, unknown>>;
}) {
  const positions: Record<string, Record<string, unknown>> = options?.positions ?? {
    'pos-1': makePosition(),
  };
  const departments: Record<string, Record<string, unknown>> = options?.departments ?? {};

  const positionRepository = {
    findById: jest.fn(async (org: string, id: string) => {
      const p = positions[id];
      return p && p.organisationId === org ? p : null;
    }),
    getParentId: jest.fn(async (id: string) => positions[id]?.reportsToPositionId ?? null),
    create: jest.fn(async (data: Record<string, unknown>) => ({
      position: { ...makePosition(), ...data, id: 'pos-new' },
      wasCreated: true,
    })),
    update: jest.fn(async (org: string, id: string, data: Record<string, unknown>) => {
      const p = positions[id];
      if (!p || p.organisationId !== org) return null;
      return { ...p, ...data };
    }),
    activate: jest.fn(async (org: string, id: string) => {
      const p = positions[id];
      return p && p.organisationId === org ? { ...p, status: 'ACTIVE' } : null;
    }),
    deactivate: jest.fn(async (org: string, id: string) => {
      const p = positions[id];
      return p && p.organisationId === org ? { ...p, status: 'INACTIVE' } : null;
    }),
    countEmployees: jest.fn(async () => 0),
  };

  const departmentRepository = {
    findById: jest.fn(async (org: string, id: string) => {
      const d = departments[id];
      return d && d.organisationId === org ? d : null;
    }),
  };

  const service = new PositionService(positionRepository as never, departmentRepository as never);
  return { service, positionRepository, departmentRepository };
}

describe('PositionService', () => {
  it('update(): rejects a position reporting to itself', async () => {
    const { service } = makeService();
    await expect(
      service.update(ORG, 'pos-1', { reportsToPositionId: 'pos-1' } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('update(): rejects a circular reports-to hierarchy', async () => {
    const positions = {
      'pos-1': makePosition({ id: 'pos-1', reportsToPositionId: 'pos-2' }),
      'pos-2': makePosition({ id: 'pos-2', code: 'P2', title: 'P2' }),
    };
    const { service } = makeService({ positions });
    await expect(
      service.update(ORG, 'pos-2', { reportsToPositionId: 'pos-1' } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('update(): allows a valid reports-to reassignment', async () => {
    const positions = {
      'pos-1': makePosition({ id: 'pos-1' }),
      'pos-2': makePosition({ id: 'pos-2', code: 'P2', title: 'P2' }),
    };
    const { service } = makeService({ positions });
    const updated = await service.update(ORG, 'pos-2', { reportsToPositionId: 'pos-1' } as never);
    expect(updated.reportsToPositionId).toBe('pos-1');
  });

  it('create(): rejects a department from a different organisation', async () => {
    const departments = { 'dept-1': { id: 'dept-1', organisationId: OTHER_ORG } };
    const { service } = makeService({ positions: {}, departments });
    await expect(
      service.create(ORG, { code: 'X', title: 'X', departmentId: 'dept-1' } as never, 'u1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('tenant isolation: getById() throws for a position in a different organisation', async () => {
    const { service } = makeService();
    await expect(service.getById(OTHER_ORG, 'pos-1')).rejects.toThrow(NotFoundException);
  });

  it('deactivate()/activate() flip status', async () => {
    const { service } = makeService();
    expect((await service.deactivate(ORG, 'pos-1')).status).toBe('INACTIVE');
    expect((await service.activate(ORG, 'pos-1')).status).toBe('ACTIVE');
  });
});
