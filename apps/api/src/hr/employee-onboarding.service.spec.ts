import { BadRequestException, NotFoundException } from '@nestjs/common';

import { EmployeeOnboardingService } from './employee-onboarding.service';

const ORG = 'org-1';

function makeTask(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'task-1',
    organisationId: ORG,
    onboardingId: 'onb-1',
    title: 'Collect employment documentation',
    isRequired: true,
    completedAt: null,
    completedByUserId: null,
    ...overrides,
  };
}

function makeOnboarding(
  tasks: Record<string, unknown>[],
  overrides: Partial<Record<string, unknown>> = {},
) {
  return {
    id: 'onb-1',
    organisationId: ORG,
    employeeId: 'emp-1',
    status: 'IN_PROGRESS',
    completedAt: null,
    tasks,
    ...overrides,
  };
}

function makeService(options?: {
  onboarding?: Record<string, unknown> | null;
  employee?: Record<string, unknown> | null;
}) {
  const employee =
    options?.employee !== undefined
      ? options.employee
      : { id: 'emp-1', organisationId: ORG, employmentStatus: 'ONBOARDING' };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let onboarding: any =
    options?.onboarding !== undefined
      ? options.onboarding
      : makeOnboarding([
          makeTask({ id: 't1', isRequired: true }),
          makeTask({ id: 't2', isRequired: false }),
        ]);

  const onboardingRepository = {
    findByEmployeeId: jest.fn(async (org: string, employeeId: string) =>
      onboarding && onboarding.organisationId === org && onboarding.employeeId === employeeId
        ? onboarding
        : null,
    ),
    startOrGet: jest.fn(async (_org: string, _employeeId: string) => {
      if (onboarding) return { onboarding, wasCreated: false };
      onboarding = makeOnboarding([
        makeTask({ id: 't1', isRequired: true }),
        makeTask({ id: 't2', isRequired: false }),
      ]);
      return { onboarding, wasCreated: true };
    }),
    completeTask: jest.fn(async (org: string, taskId: string, completedByUserId: string) => {
      const task = (onboarding as { tasks: Record<string, unknown>[] })?.tasks.find(
        (t) => t.id === taskId,
      );
      if (!task) return { task: null, wasCompleted: false };
      if (task.completedAt) return { task, wasCompleted: false };
      task.completedAt = new Date();
      task.completedByUserId = completedByUserId;
      return { task, wasCompleted: true };
    }),
    markCompleted: jest.fn(async (_org: string, _id: string) => {
      if (!onboarding) return null;
      (onboarding as Record<string, unknown>).status = 'COMPLETED';
      return onboarding;
    }),
  };

  const employeeRepository = {
    findById: jest.fn(async (org: string, id: string) =>
      employee && employee.organisationId === org && employee.id === id ? employee : null,
    ),
    setEmploymentStatus: jest.fn(async (org: string, id: string, data: Record<string, unknown>) => {
      if (employee) Object.assign(employee, data);
      return employee;
    }),
  };

  const service = new EmployeeOnboardingService(
    onboardingRepository as never,
    employeeRepository as never,
  );
  return { service, onboardingRepository, employeeRepository, getOnboarding: () => onboarding };
}

describe('EmployeeOnboardingService', () => {
  it('start(): creates onboarding with the default checklist and moves a DRAFT employee to ONBOARDING', async () => {
    const { service, employeeRepository } = makeService({
      onboarding: null,
      employee: { id: 'emp-1', organisationId: ORG, employmentStatus: 'DRAFT' },
    });
    const { onboarding, wasCreated } = await service.start(ORG, 'emp-1', undefined);
    expect(wasCreated).toBe(true);
    expect(onboarding.tasks.length).toBeGreaterThan(0);
    expect(employeeRepository.setEmploymentStatus).toHaveBeenCalledWith(ORG, 'emp-1', {
      employmentStatus: 'ONBOARDING',
    });
  });

  it('start(): is soft-idempotent — a second call returns the existing onboarding without creating a duplicate', async () => {
    const { service, onboardingRepository } = makeService();
    const { wasCreated } = await service.start(ORG, 'emp-1', undefined);
    expect(wasCreated).toBe(false);
    expect(onboardingRepository.startOrGet).toHaveBeenCalledTimes(1);
  });

  it('start(): rejects starting onboarding for a separated employee', async () => {
    const { service } = makeService({
      employee: { id: 'emp-1', organisationId: ORG, employmentStatus: 'SEPARATED' },
    });
    await expect(service.start(ORG, 'emp-1', undefined)).rejects.toThrow(BadRequestException);
  });

  it('completeTask(): marks a required task complete', async () => {
    const { service, getOnboarding } = makeService();
    const { task, wasCompleted } = await service.completeTask(ORG, 'emp-1', 't1', 'user-1');
    expect(wasCompleted).toBe(true);
    expect(task.completedAt).not.toBeNull();
    expect(
      getOnboarding()!.tasks.find((t: Record<string, unknown>) => t.id === 't1')?.completedAt,
    ).not.toBeNull();
  });

  it('completeTask(): marks an optional (non-required) task complete', async () => {
    const { service } = makeService();
    const { task, wasCompleted } = await service.completeTask(ORG, 'emp-1', 't2', 'user-1');
    expect(wasCompleted).toBe(true);
    expect(task.isRequired).toBe(false);
  });

  it('completeTask(): completing an already-completed task is idempotent (no error, wasCompleted false)', async () => {
    const { service } = makeService();
    await service.completeTask(ORG, 'emp-1', 't1', 'user-1');
    const { wasCompleted } = await service.completeTask(ORG, 'emp-1', 't1', 'user-1');
    expect(wasCompleted).toBe(false);
  });

  it("completeTask(): rejects a task id that does not belong to this employee's onboarding", async () => {
    const { service } = makeService();
    await expect(service.completeTask(ORG, 'emp-1', 'not-a-real-task', 'user-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('complete(): rejects completion while a required task is still incomplete', async () => {
    const { service } = makeService();
    await expect(service.complete(ORG, 'emp-1', undefined)).rejects.toThrow(BadRequestException);
  });

  it('complete(): succeeds once all required tasks are done, leaving the optional task incomplete', async () => {
    const { service } = makeService();
    await service.completeTask(ORG, 'emp-1', 't1', 'user-1');
    const { onboarding, wasCompleted } = await service.complete(ORG, 'emp-1', 'All set');
    expect(wasCompleted).toBe(true);
    expect(onboarding.status).toBe('COMPLETED');
  });

  it('complete(): moves an ONBOARDING employee to ACTIVE on successful completion', async () => {
    const { service, employeeRepository } = makeService();
    await service.completeTask(ORG, 'emp-1', 't1', 'user-1');
    await service.complete(ORG, 'emp-1', undefined);
    expect(employeeRepository.setEmploymentStatus).toHaveBeenCalledWith(ORG, 'emp-1', {
      employmentStatus: 'ACTIVE',
    });
  });

  it('complete(): is idempotent — completing an already-completed onboarding a second time does not error', async () => {
    const { service } = makeService();
    await service.completeTask(ORG, 'emp-1', 't1', 'user-1');
    await service.complete(ORG, 'emp-1', undefined);
    const { wasCompleted } = await service.complete(ORG, 'emp-1', undefined);
    expect(wasCompleted).toBe(false);
  });

  it('tenant isolation: getByEmployeeId() throws for an onboarding record in a different organisation', async () => {
    const { service } = makeService();
    await expect(service.getByEmployeeId('org-2', 'emp-1')).rejects.toThrow(NotFoundException);
  });
});
