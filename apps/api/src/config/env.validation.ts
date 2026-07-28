import { baseEnvSchema, z } from '@zentuva/validation';

/**
 * Foundation-level environment schema. Domain modules extend this with their own
 * required variables as they are built — do not add business-specific vars here.
 */
export const envSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${parsed.error.toString()}`);
  }
  return parsed.data;
}
