import { BadRequestException, PipeTransform } from '@nestjs/common';
import { ZodSchema } from 'zod';

/**
 * Validates a request body against a shared Zod schema from `@zentuva/validation` — per
 * the brief ("use the existing shared Zod schemas... avoid duplicating validation
 * logic"), no parallel class-validator DTOs were created for auth endpoints.
 */
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(result.error.flatten());
    }
    return result.data;
  }
}
