import { AuditService } from '../../identity/audit/audit.service';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { InterviewEvaluationController } from './interview-evaluation.controller';
import { InterviewEvaluationService } from './interview-evaluation.service';
import { InterviewService } from './interview.service';

/** Sprint 30 (recruitment.md §"Interview Evaluation" / §"Independent Evaluation
 *  Privacy") — regression coverage for a bug caught during live verification:
 *  `getOne()` originally called `InterviewService.getById()`, whose repository
 *  query does not join `application.candidate`/`application.vacancy`, causing
 *  the mobile evaluation page to crash with `Cannot read properties of
 *  undefined (reading 'firstName')`. It must call `getByIdWithRelations()`
 *  instead — but that method's include also carries every evaluator's
 *  `evaluations` and every `decisions` row, which this self-scoped endpoint
 *  must NEVER forward to the caller (only their own evaluation, returned
 *  separately as `ownEvaluation`). */
describe('InterviewEvaluationController.getOne', () => {
  const tokenUser: TokenPayload = {
    sub: 'user-1',
    organisationId: 'org-1',
    sessionId: 'session-1',
  };

  function makeController() {
    const fullInterview = {
      id: 'interview-1',
      scheduledAt: new Date('2026-10-06T09:00:00.000Z'),
      durationMinutes: 30,
      location: null,
      meetingLink: null,
      status: 'SCHEDULED',
      interviewStage: { id: 'stage-1', name: 'Finance Interview', sequence: 1 },
      application: {
        candidate: { firstName: 'Tobi', lastName: 'Fashola' },
        vacancy: { title: 'Cashier' },
      },
      evaluations: [
        { id: 'eval-other', evaluatorUserId: 'other-user', score: 5, recommendation: 'PROCEED' },
      ],
      decisions: [{ id: 'decision-1', decision: 'ADVANCE' }],
    };

    const interviewService = {
      getByIdWithRelations: jest.fn().mockResolvedValue(fullInterview),
    } as unknown as jest.Mocked<InterviewService>;
    const evaluationService = {
      getOwnEvaluation: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<InterviewEvaluationService>;
    const auditService = { record: jest.fn() } as unknown as jest.Mocked<AuditService>;

    const controller = new InterviewEvaluationController(
      interviewService,
      evaluationService,
      auditService,
    );
    return { controller, interviewService, evaluationService };
  }

  it('fetches the interview WITH relations, not the bare getById', async () => {
    const { controller, interviewService } = makeController();

    await controller.getOne(tokenUser, 'interview-1');

    expect(interviewService.getByIdWithRelations).toHaveBeenCalledWith('org-1', 'interview-1');
  });

  it("includes the candidate and vacancy so the mobile page doesn't crash", async () => {
    const { controller } = makeController();

    const result = await controller.getOne(tokenUser, 'interview-1');

    expect(result.interview.application.candidate).toEqual({
      firstName: 'Tobi',
      lastName: 'Fashola',
    });
    expect(result.interview.application.vacancy).toEqual({ title: 'Cashier' });
  });

  it("never forwards other evaluators' evaluations or stage decisions", async () => {
    const { controller } = makeController();

    const result = await controller.getOne(tokenUser, 'interview-1');

    expect(result.interview).not.toHaveProperty('evaluations');
    expect(result.interview).not.toHaveProperty('decisions');
  });

  it("still surfaces the caller's own evaluation separately", async () => {
    const { controller, evaluationService } = makeController();
    (evaluationService.getOwnEvaluation as jest.Mock).mockResolvedValue({
      id: 'eval-mine',
      score: 4,
      recommendation: 'PROCEED',
    });

    const result = await controller.getOne(tokenUser, 'interview-1');

    expect(result.ownEvaluation).toEqual({ id: 'eval-mine', score: 4, recommendation: 'PROCEED' });
  });
});
