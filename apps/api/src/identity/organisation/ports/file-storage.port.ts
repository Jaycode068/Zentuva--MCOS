/**
 * File storage, behind an interface (Sprint 3.4 brief: "design the storage abstraction so
 * cloud storage (e.g. S3) can replace it later without changing business logic"). Mirrors
 * the established `PasswordHasher`/`TokenService`/`SessionStore` port pattern (Sprint
 * 1B.2): `SettingsController`/`OrganisationService` never touch the filesystem directly,
 * only this port. Swapping `LocalFileStorage` for an S3-backed adapter later is a new
 * class implementing this same interface, not a rewrite of anything that calls it.
 */
export interface UploadFileParams {
  /** Used to namespace storage keys per tenant (`logos/<organisationId>/<file>`) — never
   *  trusted for authorization, the caller has already checked that. */
  organisationId: string;
  /** Sub-folder within the storage root, e.g. `"logos"`. */
  folder: string;
  mimeType: string;
  buffer: Buffer;
}

export interface UploadFileResult {
  /** Absolute, ready to use directly as an `<img src>` — for local storage this points
   *  at the API's own static file route; for a future S3 adapter it would be the bucket's
   *  public/CDN URL. Callers never construct URLs themselves. */
  url: string;
  /** Storage-relative identifier, opaque to the caller, needed to {@link FileStorage.delete}
   *  this exact file later. */
  key: string;
}

export interface FileStorage {
  upload(params: UploadFileParams): Promise<UploadFileResult>;
  /** No-op (not an error) if the key doesn't exist — deleting an already-gone file isn't
   *  a failure case callers need to handle specially. */
  delete(key: string): Promise<void>;
}

export const FILE_STORAGE = Symbol('FILE_STORAGE');
