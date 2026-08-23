'use client';

import { useRef, useState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, cn } from '@zentuva/ui';

import { validateImageFile } from '@/lib/image-upload-validation';

/**
 * Shared upload/preview/replace/remove control for every image upload in the app —
 * originally built for Sprint 3.4's Branding tab logos, reused for the account profile
 * photo (a Sprint 3.3 "placeholder only" made real afterward) so both features work
 * identically rather than maintaining two copies of the same upload/preview/validation
 * logic. Upload starts immediately on file selection — there's no separate "Save" step,
 * matching how the Branding tab's logo cards already behaved.
 */
export function ImageUploadCard({
  title,
  description,
  imageUrl,
  fallbackInitials,
  shape = 'square',
  onUpload,
  onRemove,
  isUploading,
  isRemoving,
  error,
  preferCamera,
}: {
  title: string;
  description: string;
  imageUrl: string | null;
  fallbackInitials: string;
  shape?: 'square' | 'circle';
  onUpload: (file: File) => void;
  onRemove?: () => void;
  isUploading: boolean;
  isRemoving?: boolean;
  error?: string | null;
  /** Adds `capture="environment"` so a phone opens its rear camera directly (Sprint 5,
   *  same rationale/attribute as `MultiImageUploadCard`'s own `preferCamera` prop) —
   *  used by Field Sales' proof-of-delivery photo capture. */
  preferCamera?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setLocalError(null);
    const validationError = await validateImageFile(file);
    if (validationError) {
      setLocalError(validationError);
      return;
    }

    setPreview(URL.createObjectURL(file));
    onUpload(file);
  }

  const displaySrc = preview ?? imageUrl;
  const shapeClass = shape === 'circle' ? 'rounded-full' : 'rounded-lg';
  const combinedError = localError ?? error;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">{description}</p>
        <div className="flex items-center gap-4">
          {displaySrc ? (
            // eslint-disable-next-line @next/next/no-img-element -- user-uploaded URL
            <img
              src={displaySrc}
              alt=""
              className={cn(
                'h-16 w-16 border border-border bg-background object-cover',
                shapeClass,
              )}
            />
          ) : (
            <div
              className={cn(
                'flex h-16 w-16 items-center justify-center bg-brandPurple text-lg font-semibold text-brandPurple-foreground',
                shapeClass,
              )}
            >
              {fallbackInitials}
            </div>
          )}

          <div className="space-y-2">
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
              >
                {isUploading ? 'Uploading…' : imageUrl ? 'Replace' : 'Upload'}
              </Button>
              {imageUrl && onRemove && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onRemove}
                  disabled={isRemoving}
                >
                  {isRemoving ? 'Removing…' : 'Remove'}
                </Button>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/svg+xml"
              capture={preferCamera ? 'environment' : undefined}
              className="hidden"
              onChange={handleFileChange}
            />
            <p className="text-xs text-muted-foreground">PNG, JPEG, or SVG. Max 2 MB.</p>
            {combinedError && <p className="text-xs text-destructive">{combinedError}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
