import { randomUUID } from 'crypto';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join, sep } from 'path';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { FileStorage, UploadFileParams, UploadFileResult } from '../ports/file-storage.port';

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/svg+xml': '.svg',
};

/**
 * Disk-backed {@link FileStorage} for local development and MVP deployment (Sprint 3.4
 * brief: "store uploaded logos locally for MVP"). Writes under `<UPLOAD_DIR>/<folder>/
 * <organisationId>/<random-filename>` and returns an absolute URL built from
 * `API_PUBLIC_URL` + the static route mounted in `main.ts`
 * (`useStaticAssets(..., { prefix: '/api/uploads/' })`).
 *
 * A future S3 (or similar) adapter implements the same `FileStorage` interface — nothing
 * in `SettingsController`/`OrganisationService` would need to change, only the provider
 * binding in `SettingsModule`.
 */
@Injectable()
export class LocalFileStorage implements FileStorage {
  private readonly uploadsRoot: string;
  private readonly publicUrl: string;

  constructor(config: ConfigService) {
    this.uploadsRoot = config.get<string>('uploads.dir', 'uploads');
    this.publicUrl = config.get<string>('uploads.publicUrl', 'http://localhost:4000');
  }

  async upload(params: UploadFileParams): Promise<UploadFileResult> {
    const extension = EXTENSION_BY_MIME_TYPE[params.mimeType] ?? '';
    const fileName = `${randomUUID()}${extension}`;
    const relativeDir = join(params.folder, params.organisationId);
    const absoluteDir = join(process.cwd(), this.uploadsRoot, relativeDir);

    await mkdir(absoluteDir, { recursive: true });
    await writeFile(join(absoluteDir, fileName), params.buffer);

    const key = `${relativeDir}${sep}${fileName}`.split(sep).join('/');
    return { url: `${this.publicUrl}/api/uploads/${key}`, key };
  }

  async delete(key: string): Promise<void> {
    const absolutePath = join(process.cwd(), this.uploadsRoot, ...key.split('/'));
    await rm(absolutePath, { force: true });
  }
}
