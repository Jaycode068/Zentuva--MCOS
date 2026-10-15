#!/usr/bin/env node
// Stage 4E.4D.1 — narrowly scoped, one-time provisioning of the INVENTORY_ADJUSTMENT
// system account for the development organisation(s) that don't have it yet. Mirrors
// `seedInventoryAdjustmentAccount` in prisma/seed.ts EXACTLY (same idempotent
// find-then-create, same code/name/type/parent), but run standalone rather than via
// the full seed script, per this stage's explicit "do not run the full seed script"
// instruction. Uses the same `assertDevelopmentDatabaseReady` identity guard every
// other `guarded-db-*.js` wrapper uses before writing anything.
require('ts-node/register/transpile-only');
const { PrismaClient } = require('@prisma/client');
const { assertDevelopmentDatabaseReady } = require('./db-guard-common');

async function main() {
  let url;
  try {
    url = await assertDevelopmentDatabaseReady();
  } catch (err) {
    console.error(
      '\n[db-identity-guard] Refusing to provision — the configured DATABASE_URL does ' +
        'not verifiably point at the designated development database (or it could not ' +
        `be reached).\n\n${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    '[db-identity-guard] Identity verified — provisioning against the development database.',
  );
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const organisations = await prisma.organisation.findMany({ select: { id: true, name: true } });
    for (const organisation of organisations) {
      const existing = await prisma.chartOfAccount.findFirst({
        where: { organisationId: organisation.id, systemKey: 'INVENTORY_ADJUSTMENT' },
      });
      if (existing) {
        console.log(
          `[provision] "${organisation.name}" already has INVENTORY_ADJUSTMENT (${existing.code}) — skipping.`,
        );
        continue;
      }

      // Same actor every other seeded system account for this organisation already
      // carries on createdById/updatedById — both nullable, but matched for
      // consistency rather than left blank on this one row.
      const anotherSystemAccount = await prisma.chartOfAccount.findFirst({
        where: {
          organisationId: organisation.id,
          isSystemAccount: true,
          createdById: { not: null },
        },
        select: { createdById: true },
      });
      const actorUserId = anotherSystemAccount?.createdById ?? undefined;

      const conflictingCode = await prisma.chartOfAccount.findFirst({
        where: { organisationId: organisation.id, code: '6900' },
      });
      if (conflictingCode) {
        console.error(
          `[provision] CONFLICT — "${organisation.name}" already has an account at code ` +
            `6900 ("${conflictingCode.name}", systemKey: ${conflictingCode.systemKey ?? 'none'}). ` +
            'Refusing to overwrite or silently reassign. Stopping without provisioning this organisation.',
        );
        process.exitCode = 1;
        continue;
      }

      const expensesParent = await prisma.chartOfAccount.findFirst({
        where: { organisationId: organisation.id, code: '6000' },
      });
      const created = await prisma.chartOfAccount.create({
        data: {
          organisationId: organisation.id,
          code: '6900',
          name: 'Inventory Adjustment / Shrinkage',
          type: 'EXPENSE',
          description: null,
          isSystemAccount: true,
          systemKey: 'INVENTORY_ADJUSTMENT',
          parentId: expensesParent?.id,
          createdById: actorUserId,
          updatedById: actorUserId,
        },
      });
      console.log(
        `[provision] Created INVENTORY_ADJUSTMENT for "${organisation.name}": id=${created.id}, code=${created.code}.`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
