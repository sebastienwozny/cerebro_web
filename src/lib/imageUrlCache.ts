/**
 * Session-scoped cache of object URLs for image Blobs, keyed by block id.
 * Same pattern as videoUrlCache — module-level so URLs survive React
 * StrictMode double-invokes and component remounts. URLs are only released
 * when the page unloads (acceptable bound for our use case).
 *
 * On Safari, blobs read from IndexedDB sometimes carry a "detached" handle
 * across page reloads — createObjectURL succeeds but loading the URL fires
 * "WebKitBlobResource error 1". `blob.slice()` returns a fresh Blob view of
 * the same bytes, which appears to re-attach the handle for serving.
 * Synchronous, so it preserves the existing call-site API.
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
