// Shared helper for the guarded apps/api/scripts/guarded-db-*.js wrappers. Verifies
// DATABASE_URL (the operational/development variable — apps/api/.env) resolves to the
// designated development database BEFORE spawning the real Prisma command, using
// server-confirmed identity (apps/api/src/prisma/db-identity-guard.ts), not the fact
// that the variable happens to be named DATABASE_URL.
require('ts-node/register/transpile-only');
const { PrismaClient } = require('@prisma/client');
const {
  requireDevelopmentDatabaseUrl,
  verifyConnectedToDevelopmentDatabase,
  UnsafeDevelopmentDatabaseError,
} = require('../src/prisma/db-identity-guard');

/** Connects, verifies identity, disconnects. Throws before any caller proceeds if unsafe. */
async function assertDevelopmentDatabaseReady() {
  const url = requireDevelopmentDatabaseUrl();
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    await verifyConnectedToDevelopmentDatabase(prisma, url);
  } finally {
    await prisma.$disconnect();
  }
  return url;
}

module.exports = { assertDevelopmentDatabaseReady, UnsafeDevelopmentDatabaseError };
