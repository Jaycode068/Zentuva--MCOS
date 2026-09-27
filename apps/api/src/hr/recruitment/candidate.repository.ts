import { Injectable } from '@nestjs/common';
import { Candidate, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export interface CreateCandidateData {
  organisationId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  location?: string;
}

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/**
 * Sprint 30 — Recruitment & Candidate Interview Management Foundation
 * (recruitment.md §"Candidate vs Application"). A practical
 * `[organisationId, email]` duplicate check only — no cross-tenant identity
 * matching, no fuzzy matching, per the brief's own "do not over-engineer
 * candidate identity matching" instruction.
 */
@Injectable()
export class CandidateRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<Candidate | null> {
    return this.prisma.candidate.findFirst({ where: { id, organisationId } });
  }

  findByEmail(organisationId: string, email: string): Promise<Candidate | null> {
    return this.prisma.candidate.findFirst({ where: { organisationId, email } });
  }

  /** Idempotent find-or-create by `[organisationId, email]` — a concurrent duplicate
   *  application attempt for a brand-new candidate converges on exactly one
   *  `Candidate` row via the DB unique constraint, never a race-created duplicate. */
  async findOrCreate(data: CreateCandidateData): Promise<Candidate> {
    const existing = await this.findByEmail(data.organisationId, data.email);
    if (existing) {
      return existing;
    }
    try {
      return await this.prisma.candidate.create({ data });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        const raced = await this.findByEmail(data.organisationId, data.email);
        if (raced) {
          return raced;
        }
      }
      throw error;
    }
  }

  list(organisationId: string, search?: string): Promise<Candidate[]> {
    return this.prisma.candidate.findMany({
      where: {
        organisationId,
        ...(search
          ? {
              OR: [
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
