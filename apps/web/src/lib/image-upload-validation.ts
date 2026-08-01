/** Sprint 3.4 File Upload requirements: "Validate File type, Size, Dimensions
 *  (reasonable)". Type and size are also validated server-side
 *  (`apps/api/src/identity/common/image-upload-validation.ts`) — this client-side check
 *  exists purely for fast, friendly feedback before a request round-trip. Dimension
 *  checking only happens here (server-side would need an image-parsing dependency this
 *  MVP doesn't add yet).
 *
 * Shared by every image upload in the app — Sprint 3.4's Branding tab logos and the
 * account profile photo (originally a Sprint 3.3 placeholder, made real afterward) —
 * rather than each maintaining its own copy of the same three checks. */
export const ALLOWED_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml'];
export const MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024;

const MAX_DIMENSION_PX = 4000;
const MIN_DIMENSION_PX = 16;

export async function validateImageFile(file: File): Promise<string | null> {
  if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.type)) {
    return 'File must be a PNG, JPEG, or SVG image.';
  }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    return `File must be ${Math.floor(MAX_IMAGE_SIZE_BYTES / 1024)} KB or smaller.`;
  }

  // SVG has no fixed intrinsic pixel size to measure meaningfully — skip.
  if (file.type === 'image/svg+xml') {
    return null;
  }

  const dimensions = await readImageDimensions(file);
  if (!dimensions) {
    return null; // couldn't read it client-side; let the server be the final authority
  }
  if (dimensions.width > MAX_DIMENSION_PX || dimensions.height > MAX_DIMENSION_PX) {
    return `Image is too large (${dimensions.width}×${dimensions.height}px) — keep it under ${MAX_DIMENSION_PX}px per side.`;
  }
  if (dimensions.width < MIN_DIMENSION_PX || dimensions.height < MIN_DIMENSION_PX) {
    return `Image is too small — keep it at least ${MIN_DIMENSION_PX}px per side.`;
  }
  return null;
}

function readImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}
