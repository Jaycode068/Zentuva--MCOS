/*
  Warnings:

  - Added the required column `action` to the `permissions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `resource` to the `permissions` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "RoleStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PermissionScopeType" AS ENUM ('NONE', 'SCOPABLE');

-- CreateEnum
CREATE TYPE "AccessScope" AS ENUM ('ORGANISATION', 'OWN_RECORDS', 'OWN_TEAM', 'DEPARTMENT', 'ASSIGNED_RECORDS', 'ASSIGNED_TERRITORY', 'ASSIGNED_ASSETS', 'NONE');

-- AlterTable: add resource/action nullable first, backfill from the existing
-- "module.resource.action" `key` for the 7 pre-existing identity permissions, then
-- tighten to NOT NULL — the seed script re-upserts every permission (including these
-- 7) with explicit resource/action going forward, but existing rows need a one-time
-- backfill since Postgres cannot add a NOT NULL column with no default to a non-empty
-- table.
ALTER TABLE "permissions" ADD COLUMN     "action" TEXT,
ADD COLUMN     "resource" TEXT,
ADD COLUMN     "scopeType" "PermissionScopeType" NOT NULL DEFAULT 'NONE';

UPDATE "permissions"
SET "resource" = split_part("key", '.', 2),
    "action" = split_part("key", '.', 3)
WHERE "resource" IS NULL OR "action" IS NULL;

ALTER TABLE "permissions" ALTER COLUMN "action" SET NOT NULL,
ALTER COLUMN "resource" SET NOT NULL;

-- AlterTable
ALTER TABLE "role_permissions" ADD COLUMN     "scope" "AccessScope";

-- AlterTable
ALTER TABLE "roles" ADD COLUMN     "status" "RoleStatus" NOT NULL DEFAULT 'ACTIVE';
