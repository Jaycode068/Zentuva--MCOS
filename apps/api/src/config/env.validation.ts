import { baseEnvSchema, z } from '@zentuva/validation';

/**
 * Foundation-level environment schema, extended with the Identity Domain's
 * Authentication Layer config (Sprint 1B.2). Nothing security-related is hardcoded —
 * every secret/expiry/threshold below must come from the environment.
 */
export const envSchema = baseEnvSchema
  .extend({
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),

    // --- Authentication (Sprint 1B.2) ---
    BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(4).max(20).default(12),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
    JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
    JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

    MAX_LOGIN_ATTEMPTS: z.coerce.number().int().min(1).default(5),

    // --- File uploads (Sprint 3.4) — local disk for MVP, see
    // apps/api/src/identity/organisation/infrastructure/local-file-storage.ts. Both have
    // defaults so existing environments boot without any changes.
    UPLOAD_DIR: z.string().default('uploads'),
    API_PUBLIC_URL: z.string().url().default('http://localhost:4000'),
    UPLOAD_MAX_FILE_SIZE_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(2 * 1024 * 1024),

    // --- Finance (Sprint 6) — a configurable suggested default tax rate, never
    // hardcoded into calculation logic. Has a default so no existing environment needs
    // changes to boot.
    FINANCE_DEFAULT_TAX_RATE_PERCENT: z.coerce.number().min(0).max(100).default(7.5),

    // --- Email delivery (Sprint 28) — everything below is optional/defaulted so an
    // existing environment boots unchanged; `EMAIL_PROVIDER_MODE=smtp` is the only
    // thing that makes the SMTP fields load-bearing (email-provider.module.ts
    // refuses to start in `smtp` mode if any required one is missing — Sprint 28
    // brief §C "do not silently fall back... fail clearly"). Never logged/printed —
    // see docs/architecture/email-delivery.md "Configuration."
    EMAIL_PROVIDER_MODE: z.enum(['local', 'smtp']).default('local'),
    /** Absolute origin used to build clickable links in email bodies (the in-app
     *  `actionUrl` is only ever a relative path) — same role `API_PUBLIC_URL`
     *  already plays for uploaded files. */
    WEB_PUBLIC_URL: z.string().url().default('http://localhost:3000'),
    SMTP_HOST: z.string().trim().min(1).optional(),
    SMTP_PORT: z.coerce.number().int().positive().optional(),
    /** Accepts the literal strings `"true"`/`"false"` (how `.env` stores it) rather
     *  than `z.coerce.boolean()`, which would treat ANY non-empty string — including
     *  the literal text `"false"` — as `true`. */
    SMTP_SECURE: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => v === 'true'),
    SMTP_USER: z.string().trim().min(1).optional(),
    SMTP_PASS: z.string().min(1).optional(),
    /** Reserved for a future ZeptoMail REST API adapter — the SMTP adapter this
     *  sprint implements authenticates with `SMTP_USER`/`SMTP_PASS` only and never
     *  reads this value (Sprint 28 Add-On §B). Kept in the schema so its presence in
     *  `.env` doesn't fail validation, not because anything consumes it yet. */
    ZEPTOMAIL_API_KEY: z.string().optional(),
    MAIL_FROM_NAME: z.string().trim().min(1).optional(),
    MAIL_FROM_EMAIL: z.string().trim().email().optional(),
  })
  .refine((env) => env.JWT_ACCESS_SECRET !== env.JWT_REFRESH_SECRET, {
    message: 'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different values',
    path: ['JWT_REFRESH_SECRET'],
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${parsed.error.toString()}`);
  }
  return parsed.data;
}
