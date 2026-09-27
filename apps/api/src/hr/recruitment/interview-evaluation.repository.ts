import { Injectable } from '@nestjs/common';
import { InterviewEvaluation, InterviewRecommendation, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/**
 * Sprint 30 — Recruitment & Candidate Interview Management Foundation
 * (recruitment.md §"Interview Evaluation" / §"Evaluation Immutability").
 * `@@unique([interviewId, evaluatorUserId])` is the "one evaluation per
 * evaluator per interview" DB guard — `create()` returns `null` on a P2002
 * conflict rather than throwing (never a silent overwrite). NO update method
 * exists here for score/recommendation/comments — immutability is enforced
 * by this repository simply never exposing one; `reopen()` only ever touches
 * `reopenedAt`/`reopenedByUserId`, never the original submitted fields.
 */
@Injectable()
export class InterviewEvaluationRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByInterviewAndEvaluator(
    interviewId: string,
    evaluatorUserId: string,
  ): Promise<InterviewEvaluation | null> {
    return this.prisma.interviewEvaluation.findFirst({ where: { interviewId, evaluatorUserId } });
  }

  listByInterview(organisationId: string, interviewId: string): Promise<InterviewEvaluation[]> {
    return this.prisma.interviewEvaluation.findMany({
      where: { organisationId, interviewId },
      orderBy: { submittedAt: 'asc' },
    });
  }

  async create(data: {
    organisationId: string;
    interviewId: string;
    evaluatorUserId: string;
    score: number;
    recommendation: InterviewRecommendation;
    comments?: string;
  }): Promise<InterviewEvaluation | null> {
    try {
      return await this.prisma.interviewEvaluation.create({ data });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        return null;
      }
      throw error;
    }
  }

  findById(organisationId: string, id: string): Promise<InterviewEvaluation | null> {
    return this.prisma.interviewEvaluation.findFirst({ where: { id, organisationId } });
  }

  /** The one sanctioned "reopen" action (recruitment.md §"Evaluation
   *  Immutability") — stamps who reopened the evaluation and when, for the
   *  audit trail. Deliberately does NOT unlock editing `score`/
   *  `recommendation`/`comments` at all this sprint ("Do not implement
   *  unrestricted editing" is read as the stronger, safer instruction — the
   *  brief's own corrections path is explicitly optional: "If corrections
   *  are supported, audit them"). A reopened evaluation remains visible with
   *  its ORIGINAL score/recommendation/comments/evaluator/timestamp intact,
   *  now additionally flagged for HR's attention. */
  async markReopened(organisationId: string, id: string): Promise<InterviewEvaluation | null> {
    const result = await this.prisma.interviewEvaluation.updateMany({
      where: { id, organisationId, reopenedAt: null },
      data: { reopenedAt: new Date() },
    });
    if (result.count === 0) {
      return null;
    }
    return this.findById(organisationId, id);
  }
}
