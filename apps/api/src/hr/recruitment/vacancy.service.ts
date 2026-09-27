import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Vacancy } from '@prisma/client';
import { CreateVacancyInput, UpdateVacancyInput } from '@zentuva/validation';

import { DepartmentService } from '../department.service';
import { PositionService } from '../position.service';
import { HiringRequestRepository } from './hiring-request.repository';
import { ListVacanciesParams, VacancyRepository } from './vacancy.repository';

/**
 * Sprint 30 — Recruitment & Candidate Interview Management Foundation
 * (recruitment.md §"Vacancy"). Not every vacancy needs a `HiringRequest`
 * (nullable `hiringRequestId`) — an administrative vacancy is a legitimate
 * use case, per the brief.
 */
@Injectable()
export class VacancyService {
  constructor(
    private readonly vacancyRepository: VacancyRepository,
    private readonly departmentService: DepartmentService,
    private readonly positionService: PositionService,
    private readonly hiringRequestRepository: HiringRequestRepository,
  ) {}

  async getById(organisationId: string, id: string): Promise<Vacancy> {
    const vacancy = await this.vacancyRepository.findById(organisationId, id);
    if (!vacancy) {
      throw new NotFoundException('Vacancy not found');
    }
    return vacancy;
  }

  async getByIdWithRelations(organisationId: string, id: string) {
    const vacancy = await this.vacancyRepository.findByIdWithRelations(organisationId, id);
    if (!vacancy) {
      throw new NotFoundException('Vacancy not found');
    }
    return vacancy;
  }

  list(organisationId: string, params: ListVacanciesParams = {}) {
    return this.vacancyRepository.list(organisationId, params);
  }

  async create(organisationId: string, input: CreateVacancyInput, createdById: string) {
    await this.positionService.getById(organisationId, input.positionId);
    if (input.departmentId) {
      await this.departmentService.getById(organisationId, input.departmentId);
    }
    if (input.hiringRequestId) {
      const hiringRequest = await this.hiringRequestRepository.findById(
        organisationId,
        input.hiringRequestId,
      );
      if (!hiringRequest) {
        throw new NotFoundException('Hiring request not found');
      }
      // Sprint "Hiring Request → HR Approval → Public Vacancy Flow" audit
      // (recruitment.md §"Hiring Request → Vacancy Conversion") — a vacancy
      // may ONLY be linked to a hiring request that has actually been
      // approved. Previously this only checked existence, so a DRAFT,
      // SUBMITTED, REJECTED, or CANCELLED request could be silently linked
      // to a new vacancy, collapsing "our department needs someone" into
      // "HR has approved this opportunity" without HR ever approving
      // anything.
      if (hiringRequest.status !== 'APPROVED') {
        throw new BadRequestException(
          `Hiring request must be APPROVED to create a vacancy from it (currently ${hiringRequest.status})`,
        );
      }
    }
    if (await this.vacancyRepository.slugExists(organisationId, input.publicSlug)) {
      throw new BadRequestException('A vacancy with this URL slug already exists');
    }

    return this.vacancyRepository.create({
      organisation: { connect: { id: organisationId } },
      title: input.title,
      position: { connect: { id: input.positionId } },
      department: input.departmentId ? { connect: { id: input.departmentId } } : undefined,
      hiringRequest: input.hiringRequestId ? { connect: { id: input.hiringRequestId } } : undefined,
      numberOfOpenings: input.numberOfOpenings,
      employmentType: input.employmentType,
      workArrangement: input.workArrangement,
      location: input.location,
      salaryMin: input.salaryMin,
      salaryMax: input.salaryMax,
      description: input.description,
      responsibilities: input.responsibilities,
      requirements: input.requirements,
      qualifications: input.qualifications,
      experienceRequirements: input.experienceRequirements,
      applicationDeadline: input.applicationDeadline,
      publicSlug: input.publicSlug,
      createdById,
      questions: {
        create: input.questions.map((q) => ({
          organisation: { connect: { id: organisationId } },
          label: q.label,
          type: q.type,
          required: q.required,
          sortOrder: q.sortOrder,
        })),
      },
    });
  }

  async update(organisationId: string, id: string, input: UpdateVacancyInput): Promise<Vacancy> {
    await this.getById(organisationId, id);
    if (input.positionId) {
      await this.positionService.getById(organisationId, input.positionId);
    }
    if (input.departmentId) {
      await this.departmentService.getById(organisationId, input.departmentId);
    }
    if (input.publicSlug) {
      const existing = await this.vacancyRepository.findBySlug(organisationId, input.publicSlug);
      if (existing && existing.id !== id) {
        throw new BadRequestException('A vacancy with this URL slug already exists');
      }
    }
    const updated = await this.vacancyRepository.update(organisationId, id, {
      title: input.title,
      position: input.positionId ? { connect: { id: input.positionId } } : undefined,
      department: input.departmentId ? { connect: { id: input.departmentId } } : undefined,
      numberOfOpenings: input.numberOfOpenings,
      employmentType: input.employmentType,
      workArrangement: input.workArrangement,
      location: input.location,
      salaryMin: input.salaryMin,
      salaryMax: input.salaryMax,
      description: input.description,
      responsibilities: input.responsibilities,
      requirements: input.requirements,
      qualifications: input.qualifications,
      experienceRequirements: input.experienceRequirements,
      applicationDeadline: input.applicationDeadline,
      publicSlug: input.publicSlug,
    });
    if (!updated) {
      throw new NotFoundException('Vacancy not found');
    }
    return updated;
  }

  async publish(organisationId: string, id: string): Promise<{ transitioned: boolean }> {
    await this.getById(organisationId, id);
    const { transitioned } = await this.vacancyRepository.publish(organisationId, id);
    if (!transitioned) {
      throw new BadRequestException('Vacancy must be DRAFT or PAUSED to publish');
    }
    return { transitioned };
  }

  async pause(organisationId: string, id: string): Promise<{ transitioned: boolean }> {
    await this.getById(organisationId, id);
    const { transitioned } = await this.vacancyRepository.pause(organisationId, id);
    if (!transitioned) {
      throw new BadRequestException('Vacancy must be PUBLISHED to pause');
    }
    return { transitioned };
  }

  async close(organisationId: string, id: string): Promise<{ transitioned: boolean }> {
    await this.getById(organisationId, id);
    const { transitioned } = await this.vacancyRepository.close(organisationId, id);
    if (!transitioned) {
      throw new BadRequestException('Vacancy must be PUBLISHED or PAUSED to close');
    }
    return { transitioned };
  }

  async cancel(organisationId: string, id: string): Promise<{ transitioned: boolean }> {
    await this.getById(organisationId, id);
    const { transitioned } = await this.vacancyRepository.cancel(organisationId, id);
    if (!transitioned) {
      throw new BadRequestException('Vacancy cannot be cancelled from its current status');
    }
    return { transitioned };
  }
}
