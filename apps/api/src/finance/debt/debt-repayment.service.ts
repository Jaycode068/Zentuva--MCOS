import { Injectable } from '@nestjs/common';
import { CreateDebtRepaymentInput } from '@zentuva/validation';

import { CreateDebtRepaymentResult, DebtRepaymentRepository } from './debt-repayment.repository';

/** Domain service for `DebtRepayment` (Sprint 17, docs/domains/
 *  debt-management.md §5/§15) — a thin pass-through; all validation and
 *  accounting live in the repository's own transaction. */
@Injectable()
export class DebtRepaymentService {
  constructor(private readonly debtRepaymentRepository: DebtRepaymentRepository) {}

  create(
    organisationId: string,
    debtFacilityId: string,
    input: CreateDebtRepaymentInput,
    actorUserId: string,
  ): Promise<CreateDebtRepaymentResult> {
    return this.debtRepaymentRepository.create({
      organisationId,
      debtFacilityId,
      cashAccountId: input.cashAccountId,
      paymentDate: input.paymentDate,
      principalAmount: input.principalAmount,
      interestAmount: input.interestAmount,
      feeAmount: input.feeAmount,
      feeExpenseAccountId: input.feeExpenseAccountId,
      reference: input.reference,
      notes: input.notes,
      idempotencyKey: input.idempotencyKey,
      createdById: actorUserId,
    });
  }
}
