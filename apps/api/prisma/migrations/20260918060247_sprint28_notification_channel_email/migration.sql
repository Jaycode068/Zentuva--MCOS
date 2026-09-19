-- Sprint 28: split into its own migration because Postgres requires a new enum
-- value to be committed before it can be referenced (e.g. as a column DEFAULT)
-- elsewhere in the same transaction — see the next migration for everything else.
ALTER TYPE "NotificationChannel" ADD VALUE 'EMAIL';
