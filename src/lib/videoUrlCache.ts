/**
 * Session-scoped cache of object URLs for video Blobs, keyed by block id.
 *
 * Why module-level: React StrictMode double-invokes effects in dev, which
 * would revoke an object URL right after we created it if we tied the URL
 * lifecycle to a component. A module-level cache lets us create each URL
 * once, regardless of how many times a component remounts.
 *
 * We intentionally never revoke here — Blob URLs are released when the page
 * unloads. Leak is bounded to the set of distinct videos opened this session,
 * which is fine for our use case.
 */
const cache = new Map<string, string>();

export function getVideoUrl(blockId: string, blob: Blob): string {
  let url = cache.get(blockId);
  if (!url) {
    // Note: don't blob.slice() here. Safari needs the original blob handle
    // for the <video> element to seek/decode properly — a sliced view stops
    // playing on Safari even when the underlying bytes are intact.
    url = URL.createObjectURL(blob);
    cache.set(blockId, url);
  }
  return url;
}
