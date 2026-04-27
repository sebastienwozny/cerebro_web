/**
 * Session-scoped cache of object URLs for image Blobs, keyed by block id.
 * Same pattern as videoUrlCache — module-level so URLs survive React
 * StrictMode double-invokes and component remounts. URLs are only released
 * when the page unloads (acceptable bound for our use case).
 */
const cache = new Map<string, string>();

export function getImageUrl(blockId: string, blob: Blob): string {
  let url = cache.get(blockId);
  if (!url) {
    url = URL.createObjectURL(blob);
    cache.set(blockId, url);
  }
  return url;
}
