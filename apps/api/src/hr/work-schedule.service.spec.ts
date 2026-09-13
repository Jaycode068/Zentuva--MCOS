import { BadRequestException, NotFoundException } from '@nestjs/common';

import { WorkScheduleService } from './work-schedule.service';

const ORG = 'org-1';
const OTHER_ORG = 'org-2';

function makeSchedule(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'ws-1',
    organisationId: ORG,
    code: 'STD-WEEKDAY',
    name: 'Standard Weekday',
    workDays: [1, 2, 3, 4, 5],
    expectedStartTime: '09:00',
    expectedEndTime: '17:00',
    gracePeriodMinutes: 10,
    status: 'ACTIVE',
    ...overrides,
  };
}

function makeService(
  schedules: Record<string, Record<string, unknown>> = { 'ws-1': makeSchedule() },
) {
  const repository = {
    findById: jest.fn(async (org: string, id: string) => {
      const s = schedules[id];
      return s && s.organisationId === org ? s : null;
    }),
    findManyByOrganisation: jest.fn(async (org: string) =>
      Object.values(schedules).filter((s) => s.organisationId === org),
    ),
    create: jest.fn(async (data: Record<string, unknown>) => {
      const existing = Object.values(schedules).find(
        (s) => s.organisationId === data.organisationId && s.code === data.code,
      );
      if (existing) return { workSchedule: existing, wasCreated: false };
      const created = { ...makeSchedule(), ...data, id: `ws-${Object.keys(schedules).length + 1}` };
      schedules[created.id] = created;
      return { workSchedule: created, wasCreated: true };
    }),
    update: jest.fn(async (org: string, id: string, data: Record<string, unknown>) => {
      const s = schedules[id];
      if (!s || s.organisationId !== org) return null;
      schedules[id] = { ...s, ...data };
      return schedules[id];
    }),
    activate: jest.fn(async (org: string, id: string) => {
      const s = schedules[id];
      if (!s || s.organisationId !== org) return null;
      schedules[id] = { ...s, status: 'ACTIVE' };
      return schedules[id];
    }),
    deactivate: jest.fn(async (org: string, id: string) => {
      const s = schedules[id];
      if (!s || s.organisationId !== org) return null;
      schedules[id] = { ...s, status: 'INACTIVE' };
      return schedules[id];
    }),
  };

  const service = new WorkScheduleService(repository as never);
  return { service, repository };
}

describe('WorkScheduleService', () => {
  it('create(): rejects identical start and end time', async () => {
    const { service } = makeService();
    await expect(
      service.create(ORG, {
        code: 'BAD',
        name: 'Bad',
        workDays: [1],
        expectedStartTime: '09:00',
        expectedEndTime: '09:00',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('create(): allows an overnight schedule (end before start)', async () => {
    const { service } = makeService();
    const { workSchedule } = await service.create(ORG, {
      code: 'NIGHT',
      name: 'Night Shift',
      workDays: [1, 2, 3, 4, 5],
      expectedStartTime: '22:00',
      expectedEndTime: '06:00',
    });
    expect(workSchedule.expectedStartTime).toBe('22:00');
  });

  it('create(): idempotent on duplicate code — returns the existing schedule', async () => {
    const { service } = makeService();
    const { wasCreated } = await service.create(ORG, {
      code: 'STD-WEEKDAY',
      name: 'Standard Weekday (again)',
      workDays: [1, 2, 3, 4, 5],
      expectedStartTime: '09:00',
      expectedEndTime: '17:00',
    });
    expect(wasCreated).toBe(false);
  });

  it('getById(): tenant isolation — throws for a schedule in a different organisation', async () => {
    const { service } = makeService();
    await expect(service.getById(OTHER_ORG, 'ws-1')).rejects.toThrow(NotFoundException);
  });

  it('activate()/deactivate(): toggles status', async () => {
    const { service } = makeService({ 'ws-1': makeSchedule({ status: 'INACTIVE' }) });
    const activated = await service.activate(ORG, 'ws-1');
    expect(activated.status).toBe('ACTIVE');
    const deactivated = await service.deactivate(ORG, 'ws-1');
    expect(deactivated.status).toBe('INACTIVE');
  });

  it('update(): re-validates start/end time when either is changed', async () => {
    const { service } = makeService();
    await expect(
      service.update(ORG, 'ws-1', { expectedStartTime: '17:00', expectedEndTime: '17:00' }),
    ).rejects.toThrow(BadRequestException);
  });
});
