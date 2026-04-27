import { v4 as uuid } from "uuid";
import type { NoteBlock } from "../store/db";

/**
 * Import images and videos from a Twitter/X post via vxtwitter's free
 * public API. Each media item becomes its own card on the canvas, with
 * a clickable "@handle on X" link block underneath.
 *
 * Why vxtwitter: free, no auth, returns direct CDN URLs for both images
 * and videos (mp4, not HLS). Fallback for if it goes down: fxtwitter
 * exposes a similar JSON shape at the same paths.
 */

const X_URL_RE = /^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[^/]+\/status\/\d+/i;

export function isXUrl(url: string): boolean {
  return X_URL_RE.test(url.trim());
}

export interface XMediaBlock {
  block: NoteBlock;        // image or video block (header)
  link: NoteBlock;         // text block with the tweet URL
}

export async function importXAsBlocks(rawUrl: string): Promise<XMediaBlock[]> {
  const url = rawUrl.trim();
  // Strip query/hash and replace x.com/twitter.com → vxtwitter.com domain.
  const path = url.replace(/^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)/i, "");
  const apiUrl = `https://api.vxtwitter.com${path.replace(/[?#].*$/, "")}`;

  const res = await fetch(apiUrl);
  if (!res.ok) throw new Error(`vxtwitter HTTP ${res.status}`);
  const post = await res.json() as VxTwitterPost;

  const tweetUrl = post.tweetURL ?? url;
  const media = post.media_extended ?? [];
  if (media.length === 0) throw new Error("This tweet has no media to import");

  const result: XMediaBlock[] = [];
  const errors: string[] = [];
  for (const m of media) {
    try {
      if (m.type === "image") {
        const block = await imageToBlock(m.url);
        if (block) result.push({ block, link: linkBlock(tweetUrl) });
      } else if (m.type === "video" || m.type === "gif") {
        // video.twimg.com refuses cross-origin fetches (Referer check) so
        // the direct mp4 URL 403s. Fall back to the video poster image
        // (pbs.twimg.com, CORS-friendly): the card becomes a still
        // preview, and the tweet URL underneath lets the user click
        // through to the actual video on Twitter.
        let block: NoteBlock | null = null;
        try {
          block = await videoToBlock(m.url, m.thumbnail_url);
        } catch (videoErr) {
          // eslint-disable-next-line no-console
          console.warn("[xPostImport] video fetch failed, falling back to thumbnail", videoErr);
        }
        if (!block && m.thumbnail_url) {
          block = await imageToBlock(m.thumbnail_url);
        }
        if (block) result.push({ block, link: linkBlock(tweetUrl) });
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[xPostImport] media fetch failed", m.url, e);
      errors.push((e as Error).message ?? String(e));
    }
  }
  if (result.length === 0) {
    const detail = errors[0] ?? "no compatible media";
    throw new Error(`Couldn't fetch tweet media: ${detail}`);
  }
  return result;
}

function linkBlock(url: string): NoteBlock {
  const handle = url.match(/(?:x\.com|twitter\.com)\/([^/]+)\/status\//i)?.[1];
  const label = handle ? `@${handle} on X` : "View on X";
  const safeUrl = url.replace(/"/g, "&quot;");
  return {
    id: uuid(),
    type: "text",
    content: `<a href="${safeUrl}" target="_blank">${label}</a>`,
  };
}

async function imageToBlock(url: string): Promise<NoteBlock | null> {
  // pbs.twimg.com images usually allow CORS, but we route through the
  // proxy too so cached-edge responses make repeats instant and so we
  // don't get bitten if Twitter tightens its policy later.
  const res = await fetch(viaProxy(url));
  if (!res.ok) return null;
  const blob = await res.blob();
  const img = await loadImage(blob);
  return {
    id: uuid(),
    type: "image",
    content: "",
    imageBlob: blob,
    imageMimeType: blob.type || "image/jpeg",
    imageAspect: img.naturalHeight / img.naturalWidth,
  };
}

/** Twimg.com (video.twimg.com / pbs.twimg.com) refuses cross-origin
 *  browser requests because of Referer enforcement. Route through our
 *  Cloudflare Worker proxy when configured. The proxy sets the right
 *  Referer + opens CORS, so this fetch works from any browser context.
 *  See cloudflare-workers/x-media-proxy.js for the worker source. */
function viaProxy(url: string): string {
  const base = (import.meta as ImportMeta & { env: Record<string, string> }).env.VITE_X_MEDIA_PROXY_URL as string | undefined;
  if (!base) return url;
  const token = (import.meta as ImportMeta & { env: Record<string, string> }).env.VITE_X_MEDIA_PROXY_TOKEN as string | undefined;
  const params = new URLSearchParams({ url });
  if (token) params.set("token", token);
  return `${base.replace(/\/$/, "")}/?${params.toString()}`;
}

async function videoToBlock(url: string, posterUrl?: string): Promise<NoteBlock | null> {
  const res = await fetch(viaProxy(url));
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const blob = await res.blob();
  // Aspect from a freshly-loaded video element (need duration/dimensions
  // before we can dispose). Poster fetched in parallel.
  const [aspect, posterDataUrl] = await Promise.all([
    videoAspect(blob),
    posterUrl ? fetchAsDataUrl(posterUrl) : Promise.resolve(""),
  ]);
  return {
    id: uuid(),
    type: "video",
    content: "",
    videoBlob: blob,
    videoPosterDataUrl: posterDataUrl,
    videoAspect: aspect,
    videoMimeType: blob.type || "video/mp4",
  };
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const u = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(u); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(u); reject(new Error("Image decode failed")); };
    img.src = u;
  });
}

function videoAspect(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    const u = URL.createObjectURL(blob);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      const a = v.videoHeight / v.videoWidth;
      URL.revokeObjectURL(u);
      resolve(Number.isFinite(a) && a > 0 ? a : 9 / 16);
    };
    v.onerror = () => { URL.revokeObjectURL(u); resolve(9 / 16); };
    v.src = u;
  });
}

async function fetchAsDataUrl(url: string): Promise<string> {
  try {
    const res = await fetch(viaProxy(url));
    if (!res.ok) return "";
    const blob = await res.blob();
    return await new Promise<string>(resolve => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => resolve("");
      r.readAsDataURL(blob);
    });
  } catch {
    return "";
  }
}

interface VxTwitterPost {
  tweetURL?: string;
  media_extended?: Array<{
    type: "image" | "video" | "gif";
    url: string;
    thumbnail_url?: string;
    width?: number;
    height?: number;
  }>;
}
