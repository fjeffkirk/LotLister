/**
 * Resolve stored image paths for display and export.
 * - Relative paths (uploads/...) are served via /api/images/...
 * - Absolute https URLs (legacy rows) are used as-is in the browser; eBay export passes them through when already public.
 */

export function isAbsoluteImageUrl(path: string | null | undefined): boolean {
  if (!path?.trim()) return false;
  return /^https?:\/\//i.test(path.trim());
}

/** <img src> on the client: local uploads → app API; already-absolute → direct */
export function imagePathToBrowserSrc(path: string | null | undefined): string {
  if (!path?.trim()) return '';
  const p = path.trim();
  if (isAbsoluteImageUrl(p)) return p;
  return `/api/images/${encodeURIComponent(p)}`;
}

/** eBay PicURL: hosted files need NEXT_PUBLIC_APP_URL (or export base) + /api/images/... */
export function imagePathToEbayPicUrl(
  originalPath: string | null | undefined,
  imageBaseUrl: string | undefined
): string {
  if (!originalPath?.trim()) return '';
  const p = originalPath.trim();
  if (isAbsoluteImageUrl(p)) return p;
  if (imageBaseUrl) {
    const base = imageBaseUrl.replace(/\/$/, '');
    return `${base}/api/images/${encodeURIComponent(p)}`;
  }
  return p;
}
