import { Prisma } from '@prisma/client';

/** Next sequential `versionNumber` for a policy, computed inside the
 *  caller's transaction — the same server-authoritative-sequence pattern
 *  `generateEmployeeCode` established (Sprint 23). Never client-supplied. */
export async function generateNextVersionNumber(
  tx: Prisma.TransactionClient,
  policyId: string,
): Promise<number> {
  const latest = await tx.policyVersion.findFirst({
    where: { policyId },
    orderBy: { versionNumber: 'desc' },
    select: { versionNumber: true },
  });
  return (latest?.versionNumber ?? 0) + 1;
}
