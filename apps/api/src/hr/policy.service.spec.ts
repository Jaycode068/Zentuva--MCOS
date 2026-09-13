import { BadRequestException, NotFoundException } from '@nestjs/common';

import { PolicyService } from './policy.service';

const ORG = 'org-1';
const OTHER_ORG = 'org-2';

function makePolicy(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'pol-1',
    organisationId: ORG,
    code: 'CONDUCT',
    title: 'Workplace Conduct Policy',
    scopeType: 'ORGANISATION',
    status: 'DRAFT',
    ...overrides,
  };
}

function makeVersion(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'polv-1',
    organisationId: ORG,
    policyId: 'pol-1',
    versionNumber: 1,
    content: 'Be respectful.',
    effectiveDate: new Date('2026-01-01'),
    requiresAcknowledgement: true,
    status: 'DRAFT',
    ...overrides,
  };
}

function makeService(options?: {
  policies?: Record<string, Record<string, unknown>>;
  versions?: Record<string, Record<string, unknown>>;
  employee?: Record<string, unknown> | null;
}) {
  const policies: Record<string, Record<string, unknown>> = options?.policies ?? {
    'pol-1': makePolicy(),
  };
  const versions: Record<string, Record<string, unknown>> = options?.versions ?? {
    'polv-1': makeVersion(),
  };
  const employee =
    options?.employee !== undefined
      ? options.employee
      : { id: 'emp-1', organisationId: ORG, userId: 'user-1' };

  const policyRepository = {
    findById: jest.fn(async (org: string, id: string) => {
      const p = policies[id];
      return p && p.organisationId === org ? p : null;
    }),
    findManyByOrganisation: jest.fn(async (org: string) =>
      Object.values(policies).filter((p) => p.organisationId === org),
    ),
    create: jest.fn(async (data: Record<string, unknown>) => {
      const id = `pol-${Object.keys(policies).length + 1}`;
      const created = { ...makePolicy(), ...data, id };
      policies[id] = created;
      return { policy: created, wasCreated: true };
    }),
    update: jest.fn(async (org: string, id: string, data: Record<string, unknown>) => {
      const p = policies[id];
      if (!p || p.organisationId !== org) return null;
      policies[id] = { ...p, ...data };
      return policies[id];
    }),
    archive: jest.fn(async (org: string, id: string) => {
      const p = policies[id];
      if (!p || p.organisationId !== org) return null;
      policies[id] = { ...p, status: 'ARCHIVED' };
      return policies[id];
    }),
    findVersionById: jest.fn(async (org: string, id: string) => {
      const v = versions[id];
      return v && v.organisationId === org ? v : null;
    }),
    findVersionsByPolicy: jest.fn(async (org: string, policyId: string) =>
      Object.values(versions).filter((v) => v.organisationId === org && v.policyId === policyId),
    ),
    createVersion: jest.fn(async (data: Record<string, unknown>) => {
      const existingForPolicy = Object.values(versions).filter((v) => v.policyId === data.policyId);
      const id = `polv-${Object.keys(versions).length + 1}`;
      const created = {
        ...makeVersion(),
        ...data,
        id,
        versionNumber: existingForPolicy.length + 1,
        status: 'DRAFT',
        publishedAt: null,
      };
      versions[id] = created;
      return created;
    }),
    publishVersion: jest.fn(async (org: string, id: string, policyId: string) => {
      const v = versions[id];
      if (!v || v.organisationId !== org || v.status !== 'DRAFT') return null;
      Object.values(versions)
        .filter((other) => other.policyId === policyId && other.status === 'PUBLISHED')
        .forEach((other) => {
          other.status = 'ARCHIVED';
        });
      versions[id] = { ...v, status: 'PUBLISHED', publishedAt: new Date() };
      return versions[id];
    }),
  };

  const departmentRepository = { findById: jest.fn(async () => ({ id: 'dept-1' })) };
  const employeeRepository = {
    findByUserId: jest.fn(async (org: string, userId: string) =>
      employee && employee.organisationId === org && employee.userId === userId ? employee : null,
    ),
    findById: jest.fn(async (org: string, id: string) =>
      employee && employee.organisationId === org && employee.id === id ? employee : null,
    ),
  };
  const acknowledgements: Record<string, Record<string, unknown>> = {};
  const acknowledgementRepository = {
    create: jest.fn(async (data: Record<string, unknown>) => {
      const key = `${data.employeeId}:${data.policyVersionId}`;
      if (acknowledgements[key]) {
        return { acknowledgement: acknowledgements[key], wasCreated: false };
      }
      const created = { id: `ack-${Object.keys(acknowledgements).length + 1}`, ...data };
      acknowledgements[key] = created;
      return { acknowledgement: created, wasCreated: true };
    }),
    findManyByEmployee: jest.fn(async () => Object.values(acknowledgements)),
  };

  const service = new PolicyService(
    policyRepository as never,
    departmentRepository as never,
    employeeRepository as never,
    acknowledgementRepository as never,
  );
  return { service, policyRepository, versions, policies };
}

describe('PolicyService — versioning', () => {
  it('createVersion(): first version is numbered 1', async () => {
    const { service } = makeService({ versions: {} });
    const version = await service.createVersion(ORG, 'pol-1', {
      content: 'v1 text',
      effectiveDate: new Date(),
    });
    expect(version.versionNumber).toBe(1);
  });

  it('createVersion(): rejects adding a version to an archived policy', async () => {
    const { service } = makeService({ policies: { 'pol-1': makePolicy({ status: 'ARCHIVED' }) } });
    await expect(
      service.createVersion(ORG, 'pol-1', { content: 'x', effectiveDate: new Date() }),
    ).rejects.toThrow(BadRequestException);
  });

  it('publishVersion(): publishing archives the previously-published version and activates the policy', async () => {
    const { service, versions, policies } = makeService({
      versions: { 'polv-1': makeVersion({ status: 'PUBLISHED' }) },
    });
    const v2 = await service.createVersion(ORG, 'pol-1', {
      content: 'v2 text',
      effectiveDate: new Date(),
    });
    await service.publishVersion(ORG, 'pol-1', v2.id, 'user-1');
    expect(versions['polv-1']!.status).toBe('ARCHIVED');
    expect(versions[v2.id]!.status).toBe('PUBLISHED');
    expect(policies['pol-1']!.status).toBe('ACTIVE');
  });

  it('publishVersion(): rejects publishing an already-published version', async () => {
    const { service } = makeService({
      versions: { 'polv-1': makeVersion({ status: 'PUBLISHED' }) },
    });
    await expect(service.publishVersion(ORG, 'pol-1', 'polv-1', 'user-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('historical (archived) versions remain visible via listVersions', async () => {
    const { service, versions } = makeService({
      versions: { 'polv-1': makeVersion({ status: 'ARCHIVED' }) },
    });
    const list = await service.listVersions(ORG, 'pol-1');
    expect(list).toHaveLength(1);
    expect(versions['polv-1']!.status).toBe('ARCHIVED');
  });

  it('tenant isolation: getById() throws for a policy in another organisation', async () => {
    const { service } = makeService();
    await expect(service.getById(OTHER_ORG, 'pol-1')).rejects.toThrow(NotFoundException);
  });
});

describe('PolicyService — acknowledgement', () => {
  it('acknowledge(): records a self-service acknowledgement for a published version', async () => {
    const { service } = makeService({
      versions: { 'polv-1': makeVersion({ status: 'PUBLISHED' }) },
    });
    const result = await service.acknowledge(ORG, 'polv-1', {}, 'user-1');
    expect(result.wasCreated).toBe(true);
    expect(result.acknowledgement.source).toBe('SELF_SERVICE');
  });

  it('acknowledge(): rejects acknowledging a draft (unpublished) version', async () => {
    const { service } = makeService();
    await expect(service.acknowledge(ORG, 'polv-1', {}, 'user-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('acknowledge(): duplicate acknowledgement for the same employee/version is a safe no-op', async () => {
    const { service } = makeService({
      versions: { 'polv-1': makeVersion({ status: 'PUBLISHED' }) },
    });
    await service.acknowledge(ORG, 'polv-1', {}, 'user-1');
    const second = await service.acknowledge(ORG, 'polv-1', {}, 'user-1');
    expect(second.wasCreated).toBe(false);
  });

  it('acknowledge(): administrative acknowledgement on behalf of a specific employee', async () => {
    const { service } = makeService({
      versions: { 'polv-1': makeVersion({ status: 'PUBLISHED' }) },
    });
    const result = await service.acknowledge(ORG, 'polv-1', { employeeId: 'emp-1' }, 'admin-1');
    expect(result.acknowledgement.source).toBe('ADMINISTRATIVE');
  });

  it('acknowledge(): rejects an employeeId from another organisation', async () => {
    const { service } = makeService({
      versions: { 'polv-1': makeVersion({ status: 'PUBLISHED' }) },
      employee: null,
    });
    await expect(
      service.acknowledge(ORG, 'polv-1', { employeeId: 'emp-cross-tenant' }, 'admin-1'),
    ).rejects.toThrow(BadRequestException);
  });
});
