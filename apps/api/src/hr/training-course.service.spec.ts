import { BadRequestException, NotFoundException } from '@nestjs/common';

import { TrainingCourseService } from './training-course.service';

const ORG = 'org-1';
const OTHER_ORG = 'org-2';

function makeCourse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'course-1',
    organisationId: ORG,
    code: 'SAFETY-101',
    title: 'Workplace Safety Induction',
    deliveryMode: 'IN_PERSON',
    status: 'DRAFT',
    ...overrides,
  };
}

function makeService(
  courses: Record<string, Record<string, unknown>> = { 'course-1': makeCourse() },
) {
  const repository = {
    findById: jest.fn(async (org: string, id: string) => {
      const c = courses[id];
      return c && c.organisationId === org ? c : null;
    }),
    findManyByOrganisation: jest.fn(async (org: string) =>
      Object.values(courses).filter((c) => c.organisationId === org),
    ),
    create: jest.fn(async (data: Record<string, unknown>) => {
      const existing = Object.values(courses).find(
        (c) => c.organisationId === data.organisationId && c.code === data.code,
      );
      if (existing) return { trainingCourse: existing, wasCreated: false };
      const id = `course-${Object.keys(courses).length + 1}`;
      const created = { ...makeCourse(), ...data, id };
      courses[id] = created;
      return { trainingCourse: created, wasCreated: true };
    }),
    update: jest.fn(async (org: string, id: string, data: Record<string, unknown>) => {
      const c = courses[id];
      if (!c || c.organisationId !== org) return null;
      courses[id] = { ...c, ...data };
      return courses[id];
    }),
    setStatus: jest.fn(async (org: string, id: string, status: string) => {
      const c = courses[id];
      if (!c || c.organisationId !== org) return null;
      courses[id] = { ...c, status };
      return courses[id];
    }),
  };

  const service = new TrainingCourseService(repository as never);
  return { service, repository };
}

describe('TrainingCourseService', () => {
  it('create(): idempotent on duplicate code', async () => {
    const { service } = makeService();
    const { wasCreated } = await service.create(ORG, {
      code: 'SAFETY-101',
      title: 'Duplicate',
      deliveryMode: 'ONLINE',
    });
    expect(wasCreated).toBe(false);
  });

  it('activate(): DRAFT -> ACTIVE', async () => {
    const { service } = makeService();
    const activated = await service.activate(ORG, 'course-1');
    expect(activated.status).toBe('ACTIVE');
  });

  it('activate(): is a no-op when already ACTIVE', async () => {
    const { service, repository } = makeService({ 'course-1': makeCourse({ status: 'ACTIVE' }) });
    await service.activate(ORG, 'course-1');
    expect(repository.setStatus).not.toHaveBeenCalled();
  });

  it('archive(): ACTIVE -> ARCHIVED', async () => {
    const { service } = makeService({ 'course-1': makeCourse({ status: 'ACTIVE' }) });
    const archived = await service.archive(ORG, 'course-1');
    expect(archived.status).toBe('ARCHIVED');
  });

  it('assertActiveForAssignment(): rejects assigning a draft course', async () => {
    const { service } = makeService();
    await expect(service.assertActiveForAssignment(ORG, 'course-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('assertActiveForAssignment(): allows an active course', async () => {
    const { service } = makeService({ 'course-1': makeCourse({ status: 'ACTIVE' }) });
    await expect(service.assertActiveForAssignment(ORG, 'course-1')).resolves.toBeDefined();
  });

  it('tenant isolation: getById() throws for a course in another organisation', async () => {
    const { service } = makeService();
    await expect(service.getById(OTHER_ORG, 'course-1')).rejects.toThrow(NotFoundException);
  });
});
