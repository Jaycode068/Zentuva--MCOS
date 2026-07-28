import { baseEnvSchema, z } from '@zentuva/validation';

const envSchema = baseEnvSchema.extend({
  NEXT_PUBLIC_API_URL: z.string().url(),
});

export const env = envSchema.parse({
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
});
