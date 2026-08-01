import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Shared by every image-upload endpoint (`SettingsController`'s logo upload, Sprint 3.4;
 * `AccountController`'s avatar upload, added afterward) — one place for the type/size
 * policy rather than two copies drifting apart.
 */
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/svg+xml']);

export function assertValidImageFile(
  file: Express.Multer.File,
  config: ConfigService,
  kind = 'Image',
): void {
  if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
    throw new BadRequestException(`${kind} must be a PNG, JPEG, or SVG image`);
  }
  const maxBytes = config.get<number>('uploads.maxFileSizeBytes', 2 * 1024 * 1024);
  if (file.size > maxBytes) {
    throw new BadRequestException(`${kind} must be ${Math.floor(maxBytes / 1024)} KB or smaller`);
  }
}
