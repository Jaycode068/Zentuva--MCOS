import { Module } from '@nestjs/common';

import { FILE_STORAGE } from '../ports/file-storage.port';
import { LocalFileStorage } from './local-file-storage';

/**
 * Provides {@link FILE_STORAGE}. Split out (mirroring `CryptoModule`, Sprint 1B.2) so
 * `IdentityModule` can import it for `OrganisationService` without a circular dependency.
 * Swapping `LocalFileStorage` for a future S3-backed adapter is a one-line change here.
 */
@Module({
  providers: [{ provide: FILE_STORAGE, useClass: LocalFileStorage }],
  exports: [FILE_STORAGE],
})
export class FileStorageModule {}
