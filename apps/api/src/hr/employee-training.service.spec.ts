import { BadRequestException, NotFoundException } from '@nestjs/common';

import { EmployeeTrainingService } from './employee-training.service';

const ORG = 'org-1';

function makeAssignment(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'et-1',
    organisationId: ORG,
    employeeId: 'emp-1',
    trainingCourseId: 'course-1',
    assignedByUserId: 'admin-1',
    assignedAt: new Date(),
    dueDate: null,
    startedAt: null,
    completedAt: null,
    status: 'ASSIGNED',
    certificateDocumentId: null,
    ...overrides,
  };
}

function makeService(options?: {
  assignments?: Record<string, Record<string, unknown>>;
  employee?: Record<string, unknown> | null;
  courseActive?: boolean;
  document?: Record<string, unknown> | null;
}) {
  const assignments = options?.assignments ?? {};
  const employee =
    options?.employee !== undefined ? options.employee : { id: 'emp-1', organisationId: ORG };
  const courseActive = options?.courseActive ?? true;
  const document = options?.document !== undefined ? options.document : null;

  const repository = {
    findById: jest.fn(async (org: string, id: string) => {
      const a = assignments[id];
      return a && a.organisationId === org ? a : null;
    }),
    findByIdWithRelations: jest.fn(async (org: string, id: string) => {
      const a = assignments[id];
      return a && a.organisationId === org ? a : null;
    }),
    findActiveAssignment: jest.fn(
      async (org: string, employeeId: string, trainingCourseId: string) =>
        Object.values(assignments).find(
          (a) =>
            a.organisationId === org &&
            a.employeeId === employeeId &&
            a.trainingCourseId === trainingCourseId &&
            ['ASSIGNED', 'IN_PROGRESS'].includes(a.status as string),
        ) ?? null,
    ),
    findManyByEmployee: jest.fn(async (org: string, employeeId: string) =>
      Object.values(assignments).filter(
        (a) => a.organisationId === org && a.employeeId === employeeId,
      ),
    ),
    findManyPaginated: jest.fn(async () => ({
      items: Object.values(assignments),
      total: Object.keys(assignments).length,
    })),
    create: jest.fn(async (data: Record<string, unknown>) => {
      const id = `et-${Object.keys(assignments).length + 1}`;
      const created = { ...makeAssignment(), ...data, id };
      assignments[id] = created;
      return created;
    }),
    update: jest.fn(async (org: string, id: string, data: Record<string, unknown>) => {
      const a = assignments[id];
      if (!a || a.organisationId !== org) return null;
      assignments[id] = { ...a, ...data };
      return assignments[id];
    }),
    syncOverdue: jest.fn(async () => undefined),
  };

  const employeeRepository = {
    findById: jest.fn(async (org: string, id: string) =>
      employee && employee.organisationId === org && employee.id === id ? employee : null,
    ),
  };

  const trainingCourseService = {
    assertActiveForAssignment: jest.fn(async () => {
      if (!courseActive)
        throw new BadRequestException('Only an active training course can be assigned');
      return { id: 'course-1' };
    }),
  };

  const employeeDocumentRepository = {
    findById: jest.fn(async (org: string, id: string) =>
      document && document.organisationId === org && document.id === id ? document : null,
    ),
  };

  const service = new EmployeeTrainingService(
    repository as never,
    employeeRepository as never,
    trainingCourseService as never,
    employeeDocumentRepository as never,
  );
  return { service, repository, assignments };
}

describe('EmployeeTrainingService — assignment', () => {
  it('assign(): creates an assignment for a valid employee and active course', async () => {
    const { service } = makeService();
    const assignment = await service.assign(ORG, 'course-1', { employeeId: 'emp-1' }, 'admin-1');
    expect(assignment.status).toBe('ASSIGNED');
  });

  it('assign(): rejects a cross-tenant employee', async () => {
    const { service } = makeService({ employee: null });
    await expect(
      service.assign(ORG, 'course-1', { employeeId: 'emp-x' }, 'admin-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('assign(): rejects assigning a non-active course', async () => {
    const { service } = makeService({ courseActive: false });
    await expect(
      service.assign(ORG, 'course-1', { employeeId: 'emp-1' }, 'admin-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('assign(): rejects a duplicate active assignment for the same employee/course', async () => {
    const { service } = makeService({ assignments: { 'et-1': makeAssignment() } });
    await expect(
      service.assign(ORG, 'course-1', { employeeId: 'emp-1' }, 'admin-1'),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('EmployeeTrainingService — completion and cancellation', () => {
  it('complete(): marks COMPLETED and stamps completedAt', async () => {
    const { service } = makeService({ assignments: { 'et-1': makeAssignment() } });
    const completed = await service.complete(ORG, 'et-1', {});
    expect(completed.status).toBe('COMPLETED');
    expect(completed.completedAt).not.toBeNull();
  });

  it('complete(): rejects completing an already-cancelled assignment', async () => {
    const { service } = makeService({
      assignments: { 'et-1': makeAssignment({ status: 'CANCELLED' }) },
    });
    await expect(service.complete(ORG, 'et-1', {})).rejects.toThrow(BadRequestException);
  });

  it('complete(): validates a certificate document belongs to the same employee', async () => {
    const { service } = makeService({
      assignments: { 'et-1': makeAssignment() },
      document: { id: 'doc-1', organisationId: ORG, employeeId: 'emp-OTHER' },
    });
    await expect(service.complete(ORG, 'et-1', { certificateDocumentId: 'doc-1' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('complete(): accepts a certificate document owned by the same employee', async () => {
    const { service } = makeService({
      assignments: { 'et-1': makeAssignment() },
      document: { id: 'doc-1', organisationId: ORG, employeeId: 'emp-1' },
    });
    const completed = await service.complete(ORG, 'et-1', { certificateDocumentId: 'doc-1' });
    expect(completed.certificateDocumentId).toBe('doc-1');
  });

  it('cancel(): CANCELLED assignment cannot be modified further', async () => {
    const { service } = makeService({ assignments: { 'et-1': makeAssignment() } });
    await service.cancel(ORG, 'et-1');
    await expect(service.cancel(ORG, 'et-1')).rejects.toThrow(BadRequestException);
  });

  it('update(): moving to IN_PROGRESS stamps startedAt', async () => {
    const { service } = makeService({ assignments: { 'et-1': makeAssignment() } });
    const updated = await service.update(ORG, 'et-1', { status: 'IN_PROGRESS' });
    expect(updated.status).toBe('IN_PROGRESS');
    expect(updated.startedAt).not.toBeNull();
  });

  it('tenant isolation: getById() throws for an assignment in another organisation', async () => {
    const { service } = makeService({ assignments: { 'et-1': makeAssignment() } });
    await expect(service.getById('org-2', 'et-1')).rejects.toThrow(NotFoundException);
  });
});
