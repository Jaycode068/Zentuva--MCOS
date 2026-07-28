import { z } from 'zod';

/** Base environment schema shared by every app; apps extend this with their own required vars. */
export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type BaseEnv = z.infer<typeof baseEnvSchema>;
