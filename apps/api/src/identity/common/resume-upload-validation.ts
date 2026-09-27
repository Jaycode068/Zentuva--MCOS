import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Sprint 30 — Recruitment & Candidate Interview Management Foundation
 * (recruitment.md §"Public Application Security"). Mirrors
 * `assertValidImageFile` (`image-upload-validation.ts`) exactly in shape —
 * this codebase's `EmployeeDocumentService` performs NO mimetype/size
 * validation at all on an uploaded file, which is acceptable for an
 * authenticated HR-only upload but not for a PUBLIC, unauthenticated one;
 * this is the minimum safe extension for that one new surface.
 */
const ALLOWED_RESUME_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const DEFAULT_MAX_RESUME_BYTES = 5 * 1024 * 1024;

export function assertValidResumeFile(file: Express.Multer.File, config: ConfigService): void {
  if (!ALLOWED_RESUME_MIME_TYPES.has(file.mimetype)) {
    throw new BadRequestException('Resume/CV must be a PDF, DOC, or DOCX file');
  }
  const maxBytes = config.get<number>('uploads.maxResumeFileSizeBytes', DEFAULT_MAX_RESUME_BYTES);
  if (file.size > maxBytes) {
    throw new BadRequestException(
      `Resume/CV must be ${Math.floor(maxBytes / (1024 * 1024))} MB or smaller`,
    );
  }
}
