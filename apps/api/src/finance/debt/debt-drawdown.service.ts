import { Injectable } from '@nestjs/common';
import { CreateDebtDrawdownInput } from '@zentuva/validation';

import { CreateDebtDrawdownResult, DebtDrawdownRepository } from './debt-drawdown.repository';

/** Domain service for `DebtDrawdown` (Sprint 17, docs/domains/
 *  debt-management.md §4/§13) — a thin pass-through; all validation and
 *  accounting live in the repository's own transaction. */
@Injectable()
export class DebtDrawdownService {
  constructor(private readonly debtDrawdownRepository: DebtDrawdownRepository) {}

  create(
    organisationId: string,
    debtFacilityId: string,
    input: CreateDebtDrawdownInput,
    actorUserId: string,
  ): Promise<CreateDebtDrawdownResult> {
    return this.debtDrawdownRepository.create({
      organisationId,
      debtFacilityId,
      cashAccountId: input.cashAccountId,
      amount: input.amount,
      drawdownDate: input.drawdownDate,
      reference: input.reference,
      notes: input.notes,
      idempotencyKey: input.idempotencyKey,
      createdById: actorUserId,
    });
  }
}
