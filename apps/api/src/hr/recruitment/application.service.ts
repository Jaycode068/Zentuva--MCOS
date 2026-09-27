import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Application } from '@prisma/client';

import { ApplicationRepository, ListApplicationsParams } from './application.repository';

/**
 * Sprint 30 — Recruitment & Candidate Interview Management Foundation
 * (recruitment.md §"HR Screening"). Internal screening notes never appear on
 * any public/candidate-facing response — only this authenticated,
 * `hr.recruitment.*`-gated surface ever reads `screeningNotes`.
 */
@Injectable()
export class ApplicationService {
  constructor(private readonly applicationRepository: ApplicationRepository) {}

  async getById(organisationId: string, id: string): Promise<Application> {
    const application = await this.applicationRepository.findById(organisationId, id);
    if (!application) {
      throw new NotFoundException('Application not found');
    }
    return application;
  }

  async getByIdWithRelations(organisationId: string, id: string) {
    const application = await this.applicationRepository.findByIdWithRelations(organisationId, id);
    if (!application) {
      throw new NotFoundException('Application not found');
    }
    return application;
  }

  list(organisationId: string, params: ListApplicationsParams = {}) {
    return this.applicationRepository.list(organisationId, params);
  }

  async screen(
    organisationId: string,
    id: string,
    screenedByUserId: string,
    screeningNotes?: string,
  ): Promise<Application> {
    const updated = await this.applicationRepository.screen(
      organisationId,
      id,
      screenedByUserId,
      screeningNotes,
    );
    if (!updated) {
      throw new BadRequestException(
        'Application must be SUBMITTED or SCREENING to record screening notes',
      );
    }
    return updated;
  }

  async shortlist(
    organisationId: string,
    id: string,
    screenedByUserId: string,
    screeningNotes?: string,
  ): Promise<Application> {
    const updated = await this.applicationRepository.shortlist(
      organisationId,
      id,
      screenedByUserId,
      screeningNotes,
    );
    if (!updated) {
      throw new BadRequestException('Application must be SUBMITTED or SCREENING to shortlist');
    }
    return updated;
  }

  async reject(
    organisationId: string,
    id: string,
    screenedByUserId: string,
    screeningNotes?: string,
  ): Promise<Application> {
    const updated = await this.applicationRepository.reject(
      organisationId,
      id,
      screenedByUserId,
      screeningNotes,
    );
    if (!updated) {
      throw new BadRequestException('Application cannot be rejected from its current status');
    }
    return updated;
  }
}
