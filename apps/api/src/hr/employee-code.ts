import { Prisma } from '@prisma/client';

const EMPLOYEE_CODE_PREFIX = 'EMP';
const EMPLOYEE_CODE_SEQUENCE_LENGTH = 6;

/**
 * Server-side, concurrency-safe `EMP-000001` code generation — the exact
 * `generateWorkOrderCode`/`generateAssetCode` linear-probe-inside-
 * `$transaction` template. Never client-supplied.
 */
export async function generateEmployeeCode(
  tx: Prisma.TransactionClient,
  organisationId: string,
): Promise<string> {
  let sequence = 1;
  let candidate = formatEmployeeCode(sequence);
  while (
    await tx.employee.findUnique({
      where: { organisationId_employeeCode: { organisationId, employeeCode: candidate } },
      select: { id: true },
    })
  ) {
    sequence += 1;
    candidate = formatEmployeeCode(sequence);
  }
  return candidate;
}

function formatEmployeeCode(sequence: number): string {
  return `${EMPLOYEE_CODE_PREFIX}-${String(sequence).padStart(EMPLOYEE_CODE_SEQUENCE_LENGTH, '0')}`;
}
