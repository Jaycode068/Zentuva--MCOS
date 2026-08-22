'use client';

import { useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@zentuva/ui';

import { validateImageFile } from '@/lib/image-upload-validation';

export interface ExistingPhoto {
  id: string;
  url: string;
  photoType: string | null;
  caption: string | null;
}

/**
 * Multi-photo counterpart to `ImageUploadCard` (Sprint 4.8, Outlet photography).
 * `ImageUploadCard` is single-file by design (`imageUrl: string | null`,
 * `onUpload: (file: File) => void`) — it structurally can't express "front, signage,
 * interior, shelf display" for one outlet, hence this new component rather than an
 * extension of it.
 *
 * Used by both the Field Sales outlet screen (immediate-upload mode: pass `onUpload`,
 * each selected file uploads right away) and the Admin outlet dialog (same immediate-
 * upload mode) — not exclusive to either surface.
 *
 * Foundational capture/store/associate only, per docs/domains/outlets.md — no image
 * analysis of any kind happens here or on the server.
 */
export function MultiImageUploadCard({
  title,
  description,
  photos,
  onUpload,
  onRemove,
  maxPhotos = 6,
  isUploading,
  removingPhotoId,
  error,
  preferCamera,
}: {
  title: string;
  description: string;
  photos: ExistingPhoto[];
  onUpload: (files: File[]) => void;
  onRemove?: (photoId: string) => void;
  maxPhotos?: number;
  isUploading?: boolean;
  removingPhotoId?: string | null;
  error?: string | null;
  /** Adds `capture="environment"` so a phone opens its rear camera directly — first use
   *  of the `capture` attribute in this codebase. */
  preferCamera?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const remainingSlots = Math.max(0, maxPhotos - photos.length);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;

    setLocalError(null);
    const valid: File[] = [];
    for (const file of files.slice(0, remainingSlots)) {
      if (file.type === 'image/svg+xml') {
        setLocalError('SVG is not supported for outlet photos.');
        continue;
      }
      const validationError = await validateImageFile(file);
      if (validationError) {
        setLocalError(validationError);
        continue;
      }
      valid.push(file);
    }
    if (valid.length > 0) {
      onUpload(valid);
    }
  }

  const combinedError = localError ?? error;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">{description}</p>
        <div className="grid grid-cols-3 gap-2">
          {photos.map((photo) => (
            <div
              key={photo.id}
              className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- user-uploaded URL */}
              <img
                src={photo.url}
                alt={photo.caption ?? ''}
                className="h-full w-full object-cover"
              />
              {onRemove && (
                <button
                  type="button"
                  onClick={() => onRemove(photo.id)}
                  disabled={removingPhotoId === photo.id}
                  className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white disabled:opacity-50"
                  aria-label="Remove photo"
                >
                  {removingPhotoId === photo.id ? '…' : '×'}
                </button>
              )}
            </div>
          ))}
          {remainingSlots > 0 && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50"
            >
              <span className="text-2xl leading-none">+</span>
              <span className="text-xs">{isUploading ? 'Uploading…' : 'Add photo'}</span>
            </button>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/png,image/jpeg"
          capture={preferCamera ? 'environment' : undefined}
          className="hidden"
          onChange={handleFileChange}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          PNG or JPEG. Max 2 MB each, up to {maxPhotos} photos.
        </p>
        {combinedError && <p className="mt-1 text-xs text-destructive">{combinedError}</p>}
      </CardContent>
    </Card>
  );
}
