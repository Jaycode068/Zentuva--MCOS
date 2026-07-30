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
