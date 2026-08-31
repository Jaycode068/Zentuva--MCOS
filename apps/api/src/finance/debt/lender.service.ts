import { Injectable, NotFoundException } from '@nestjs/common';
import { Lender } from '@prisma/client';
import { CreateLenderInput, UpdateLenderInput } from '@zentuva/validation';

import { CreateLenderResult, LenderRepository, ListLendersParams } from './lender.repository';

/** Domain service for the `Lender` aggregate (Sprint 17, docs/domains/
 *  debt-management.md §7). */
@Injectable()
export class LenderService {
  constructor(private readonly lenderRepository: LenderRepository) {}

  getById(organisationId: string, id: string): Promise<Lender> {
    return this.getByIdOrThrow(organisationId, id);
  }

  list(organisationId: string, params?: ListLendersParams): Promise<Lender[]> {
    return this.lenderRepository.findManyByOrganisation(organisationId, params);
  }

  create(
    organisationId: string,
    input: CreateLenderInput,
    actorUserId: string,
  ): Promise<CreateLenderResult> {
    return this.lenderRepository.create({
      organisationId,
      name: input.name,
      type: input.type,
      contactName: input.contactName,
      email: input.email,
      phone: input.phone,
      notes: input.notes,
      createdById: actorUserId,
    });
  }

  async update(organisationId: string, id: string, input: UpdateLenderInput): Promise<Lender> {
    await this.getByIdOrThrow(organisationId, id);
    const updated = await this.lenderRepository.update(organisationId, id, {
      name: input.name,
      contactName: input.contactName,
      email: input.email,
      phone: input.phone,
      notes: input.notes,
    });
    if (!updated) {
      throw new NotFoundException('Lender not found');
    }
    return updated;
  }

  private async getByIdOrThrow(organisationId: string, id: string): Promise<Lender> {
    const lender = await this.lenderRepository.findById(organisationId, id);
    if (!lender) {
      throw new NotFoundException('Lender not found');
    }
    return lender;
  }
}
