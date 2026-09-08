import { Prisma } from '@prisma/client';

const WORK_ORDER_CODE_PREFIX = 'WO';
const WORK_ORDER_CODE_SEQUENCE_LENGTH = 6;

/**
 * Server-side, concurrency-safe `WO-000001` code generation — the exact
 * `AssetRepository.generateAssetCode()` linear-probe-inside-`$transaction`
 * template (Sprint 20), reused here because two repositories in this one
 * domain need it: `WorkOrderRepository.create()` (ad-hoc/manual work
 * orders) and `MaintenanceScheduleRepository.generate()` (preventive work
 * orders) — a small, intra-domain helper, not a cross-domain abstraction.
 */
export async function generateWorkOrderCode(
  tx: Prisma.TransactionClient,
  organisationId: string,
): Promise<string> {
  let sequence = 1;
  let candidate = formatWorkOrderCode(sequence);
  while (
    await tx.workOrder.findUnique({
      where: { organisationId_workOrderCode: { organisationId, workOrderCode: candidate } },
      select: { id: true },
    })
  ) {
    sequence += 1;
    candidate = formatWorkOrderCode(sequence);
  }
  return candidate;
}

function formatWorkOrderCode(sequence: number): string {
  return `${WORK_ORDER_CODE_PREFIX}-${String(sequence).padStart(WORK_ORDER_CODE_SEQUENCE_LENGTH, '0')}`;
}
