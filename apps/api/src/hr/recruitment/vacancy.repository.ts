import { Injectable } from '@nestjs/common';
import { Prisma, Vacancy, VacancyStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export interface ListVacanciesParams {
  status?: VacancyStatus;
  search?: string;
}

/** Sprint 30 — Recruitment & Candidate Interview Management Foundation
 *  (recruitment.md §"Vacancy"). Thin Prisma access only. */
@Injectable()
export class VacancyRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<Vacancy | null> {
    return this.prisma.vacancy.findFirst({ where: { id, organisationId } });
  }

  findByIdWithRelations(organisationId: string, id: string) {
    return this.prisma.vacancy.findFirst({
      where: { id, organisationId },
      include: {
        position: true,
        department: true,
        questions: { orderBy: { sortOrder: 'asc' } },
        interviewStages: {
          orderBy: { sequence: 'asc' },
          include: { participants: true },
        },
      },
    });
  }

  findBySlug(organisationId: string, publicSlug: string): Promise<Vacancy | null> {
    return this.prisma.vacancy.findFirst({ where: { organisationId, publicSlug } });
  }

  async slugExists(organisationId: string, publicSlug: string): Promise<boolean> {
    const count = await this.prisma.vacancy.count({ where: { organisationId, publicSlug } });
    return count > 0;
  }

  list(organisationId: string, params: ListVacanciesParams = {}) {
    return this.prisma.vacancy.findMany({
      where: {
        organisationId,
        ...(params.status ? { status: params.status } : {}),
        ...(params.search ? { title: { contains: params.search, mode: 'insensitive' } } : {}),
      },
      include: { position: true, department: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  create(data: Prisma.VacancyCreateInput): Promise<Vacancy> {
    return this.prisma.vacancy.create({ data });
  }

  async update(
    organisationId: string,
    id: string,
    data: Prisma.VacancyUpdateInput,
  ): Promise<Vacancy | null> {
    const result = await this.prisma.vacancy.updateMany({ where: { id, organisationId }, data });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.vacancy.findUniqueOrThrow({ where: { id } });
  }

  private async transition(
    organisationId: string,
    id: string,
    fromStatuses: VacancyStatus[],
    data: Prisma.VacancyUpdateInput,
  ): Promise<{ transitioned: boolean; vacancy: Vacancy | null }> {
    const result = await this.prisma.vacancy.updateMany({
      where: { id, organisationId, status: { in: fromStatuses } },
      data,
    });
    const vacancy = await this.findById(organisationId, id);
    return { transitioned: result.count > 0, vacancy };
  }

  publish(organisationId: string, id: string) {
    return this.transition(organisationId, id, ['DRAFT', 'PAUSED'], {
      status: 'PUBLISHED',
      publishedAt: new Date(),
    });
  }

  pause(organisationId: string, id: string) {
    return this.transition(organisationId, id, ['PUBLISHED'], { status: 'PAUSED' });
  }

  close(organisationId: string, id: string) {
    return this.transition(organisationId, id, ['PUBLISHED', 'PAUSED'], {
      status: 'CLOSED',
      closedAt: new Date(),
    });
  }

  cancel(organisationId: string, id: string) {
    return this.transition(organisationId, id, ['DRAFT', 'PUBLISHED', 'PAUSED'], {
      status: 'CANCELLED',
      closedAt: new Date(),
    });
  }

  // ---------------------------------------------------------------------------
  // Public careers page — only ever reads PUBLISHED, non-expired vacancies.
  // ---------------------------------------------------------------------------

  findPublicList(organisationId: string) {
    return this.prisma.vacancy.findMany({
      where: {
        organisationId,
        status: 'PUBLISHED',
        OR: [{ applicationDeadline: null }, { applicationDeadline: { gte: new Date() } }],
      },
      include: { department: true },
      orderBy: { publishedAt: 'desc' },
    });
  }

  findPublicBySlug(organisationId: string, publicSlug: string) {
    return this.prisma.vacancy.findFirst({
      where: {
        organisationId,
        publicSlug,
        status: 'PUBLISHED',
        OR: [{ applicationDeadline: null }, { applicationDeadline: { gte: new Date() } }],
      },
      include: { department: true, questions: { orderBy: { sortOrder: 'asc' } } },
    });
  }
}
