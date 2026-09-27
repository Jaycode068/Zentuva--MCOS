import { PrismaService } from '../../prisma/prisma.service';
import { RecruitmentNotificationService } from './recruitment-notification.service';

describe('RecruitmentNotificationService', () => {
  function makeService() {
    const prisma = {
      notification: { createMany: jest.fn() },
    } as unknown as jest.Mocked<PrismaService>;
    const service = new RecruitmentNotificationService(prisma);
    return { service, prisma };
  }

  it('creates BOTH INTERVIEW_SCHEDULED and INTERVIEW_EVALUATION_REQUIRED for every participant, in one batch', async () => {
    const { service, prisma } = makeService();

    await service.notifyInterviewScheduled({
      organisationId: 'org-1',
      interviewId: 'interview-1',
      participantUserIds: ['user-1', 'user-2'],
      candidateName: 'John Doe',
      positionTitle: 'Cashier',
      stageName: 'Finance Interview',
      scheduledAt: new Date('2026-09-15T10:00:00Z'),
      actionUrl: '/hr-interviews/interview-1',
    });

    expect(prisma.notification.createMany).toHaveBeenCalledTimes(1);
    const call = (prisma.notification.createMany as jest.Mock).mock.calls[0][0];
    expect(call.skipDuplicates).toBe(true);
    expect(call.data).toHaveLength(4); // 2 participants x 2 notification types
    const types = call.data.map((row: { type: string }) => row.type).sort();
    expect(types).toEqual([
      'INTERVIEW_EVALUATION_REQUIRED',
      'INTERVIEW_EVALUATION_REQUIRED',
      'INTERVIEW_SCHEDULED',
      'INTERVIEW_SCHEDULED',
    ]);
    for (const row of call.data) {
      expect(row.sourceType).toBe('INTERVIEW');
      expect(row.sourceId).toBe('interview-1');
      expect(row.organisationId).toBe('org-1');
      expect(row.actionUrl).toBe('/hr-interviews/interview-1');
    }
  });

  it("mentions the candidate and stage in the notification body (matching the brief's own example message)", async () => {
    const { service, prisma } = makeService();

    await service.notifyInterviewScheduled({
      organisationId: 'org-1',
      interviewId: 'interview-1',
      participantUserIds: ['user-1'],
      candidateName: 'John Doe',
      positionTitle: 'Cashier',
      stageName: 'Finance Interview',
      scheduledAt: new Date('2026-09-15T10:00:00Z'),
      actionUrl: '/hr-interviews/interview-1',
    });

    const call = (prisma.notification.createMany as jest.Mock).mock.calls[0][0];
    const scheduledRow = call.data.find((r: { type: string }) => r.type === 'INTERVIEW_SCHEDULED');
    expect(scheduledRow.body).toContain('John Doe');
    expect(scheduledRow.body).toContain('Cashier');
    expect(scheduledRow.body).toContain('Finance Interview');
    expect(scheduledRow.body).toContain('You are an interviewer for this stage.');
  });

  it('is a no-op with zero participants — never calls createMany with an empty batch', async () => {
    const { service, prisma } = makeService();

    await service.notifyInterviewScheduled({
      organisationId: 'org-1',
      interviewId: 'interview-1',
      participantUserIds: [],
      candidateName: 'John Doe',
      positionTitle: 'Cashier',
      stageName: 'Finance Interview',
      scheduledAt: null,
      actionUrl: '/hr-interviews/interview-1',
    });

    expect(prisma.notification.createMany).not.toHaveBeenCalled();
  });
});
