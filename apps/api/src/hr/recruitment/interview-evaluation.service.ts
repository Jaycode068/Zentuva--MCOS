import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InterviewEvaluation } from '@prisma/client';
import { SubmitInterviewEvaluationInput } from '@zentuva/validation';

import { UserService } from '../../identity/user/user.service';
import { InterviewEvaluationRepository } from './interview-evaluation.repository';
import { InterviewRepository } from './interview.repository';

/**
 * Sprint 30 — Recruitment & Candidate Interview Management Foundation
 * (recruitment.md §"Interviewer Authorization" — a KEY authorization rule).
 * `submit()` is the ONE place that enforces "this user is actually an
 * assigned participant on THIS interview" — a direct
 * `InterviewParticipant` row lookup, never inferred from a permission alone
 * and never trusted to the frontend. Controllers additionally gate on
 * `hr.recruitment.interview.evaluate` (coarse "may act as an interviewer in
 * this organisation at all"), but that permission alone is NEVER sufficient
 * — this service's row-check is the real gate.
 *
 * Also checks live `User.status === 'ACTIVE'` before accepting a submission
 * (brief §50 "a suspended interviewer cannot perform a new evaluation") —
 * `JwtAuthGuard` alone is pure authentication and does NOT re-verify status
 * (confirmed by this codebase's own Identity research: an already-issued JWT
 * stays cryptographically valid after suspension), so this service re-checks
 * it explicitly, the same pattern `WhatsAppEligibilityService`/
 * `EmailEligibilityService` already use for their own recipient checks.
 */
@Injectable()
export class InterviewEvaluationService {
  constructor(
    private readonly evaluationRepository: InterviewEvaluationRepository,
    private readonly interviewRepository: InterviewRepository,
    private readonly userService: UserService,
  ) {}

  /** Independence (recruitment.md §"Independent Evaluation Privacy"): an
   *  evaluator sees ONLY their own evaluation until they have submitted it —
   *  never other participants' scores, which would influence their own.
   *  Callers with broader visibility (HR, via `hr.recruitment.application.view`)
   *  use `listByInterview` directly instead of this method. */
  async getOwnEvaluation(
    organisationId: string,
    interviewId: string,
    evaluatorUserId: string,
  ): Promise<InterviewEvaluation | null> {
    const isParticipant = await this.interviewRepository.isParticipant(
      interviewId,
      evaluatorUserId,
    );
    if (!isParticipant) {
      throw new ForbiddenException('You are not an interviewer for this interview');
    }
    return this.evaluationRepository.findByInterviewAndEvaluator(interviewId, evaluatorUserId);
  }

  listByInterview(organisationId: string, interviewId: string): Promise<InterviewEvaluation[]> {
    return this.evaluationRepository.listByInterview(organisationId, interviewId);
  }

  async submit(
    organisationId: string,
    interviewId: string,
    evaluatorUserId: string,
    input: SubmitInterviewEvaluationInput,
  ): Promise<InterviewEvaluation> {
    const interview = await this.interviewRepository.findById(organisationId, interviewId);
    if (!interview) {
      throw new NotFoundException('Interview not found');
    }

    const isParticipant = await this.interviewRepository.isParticipant(
      interviewId,
      evaluatorUserId,
    );
    if (!isParticipant) {
      throw new ForbiddenException('You are not an interviewer for this interview');
    }

    const evaluator = await this.userService.getById(organisationId, evaluatorUserId);
    if (!evaluator || evaluator.status !== 'ACTIVE') {
      throw new ForbiddenException('Your account is not active and cannot submit a new evaluation');
    }

    const created = await this.evaluationRepository.create({
      organisationId,
      interviewId,
      evaluatorUserId,
      score: input.score,
      recommendation: input.recommendation,
      comments: input.comments,
    });
    if (!created) {
      throw new BadRequestException(
        'You have already submitted an evaluation for this interview — evaluations are immutable',
      );
    }
    return created;
  }

  async reopen(organisationId: string, id: string): Promise<InterviewEvaluation> {
    const updated = await this.evaluationRepository.markReopened(organisationId, id);
    if (!updated) {
      throw new NotFoundException('Evaluation not found or already reopened');
    }
    return updated;
  }
}
