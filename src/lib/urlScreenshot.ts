import { v4 as uuid } from "uuid";
import type { NoteBlock } from "../store/db";

/**
 * Captures a full-page screenshot of an arbitrary URL using Microlink's
 * free tier and converts it into an image NoteBlock ready to drop on the
 * canvas. Also returns the page's title for use as initial card text.
 *
 * Microlink free tier: 50 screenshots/day. Easy to swap for a self-hosted
 * Puppeteer service later — keep the function signature stable.
 */
export interface UrlScreenshotResult {
  block: NoteBlock;
  title: string | null;
}

/** Fixed capture dimensions. Width matches a typical desktop viewport so
 *  layouts don't shift; height is generous enough to grab hero + a bit of
 *  body content without producing huge cards. Pages shorter than 3000 get
 *  white space at the bottom; pages longer get cut off. */
const VIEWPORT_WIDTH = 1440;
const VIEWPORT_HEIGHT = 1800;

export async function captureUrlScreenshot(rawUrl: string): Promise<UrlScreenshotResult> {
  const url = normalizeUrl(rawUrl);
  const params = new URLSearchParams({
    url,
    screenshot: "true",
    // Viewport-sized capture (NOT fullPage) so the card has a predictable
    // aspect ratio and stays under control on very long pages.
    fullPage: "false",
    "viewport.width": String(VIEWPORT_WIDTH),
    "viewport.height": String(VIEWPORT_HEIGHT),
    adblock: "true",
    meta: "true",
    // Default = PNG (lossless). We re-encode client-side to WebP for
    // display and JPEG q=0.95 for HD download — both are lossy but
    // encoding from a lossless source yields visibly better quality at
    // the same target size than re-encoding a Microlink JPEG.
    // `domcontentloaded` is safer than `networkidle0`: many sites fire
    // analytics/heartbeats forever, which causes networkidle0 to time out
    // and Microlink to return HTTP 500.
    waitUntil: "domcontentloaded",
    waitFor: "1500",
  });
  const result = await fetchAndBuildBlock(`https://api.microlink.io/?${params.toString()}`, url);
  if (!result) throw new Error("Microlink: capture failed");
  return result;
}

async function fetchAndBuildBlock(apiUrl: string, sourceUrl: string): Promise<UrlScreenshotResult | null> {
  const res = await fetch(apiUrl);
  let data: MicrolinkResponse | null = null;
  try { data = await res.json(); } catch { /* non-JSON response */ }
  if (!res.ok || !data || data.status !== "success") {
    const detail = data?.message ?? data?.code ?? `HTTP ${res.status}`;
    // eslint-disable-next-line no-console
    console.warn("[urlScreenshot] Microlink rejected request:", detail, data);
    throw new Error(`Microlink: ${detail}`);
  }

  const screenshotUrl = data.data.screenshot?.url;
  if (!screenshotUrl) return null;

  const imgRes = await fetch(screenshotUrl);
  if (!imgRes.ok) return null;
  const sourceBlob = await imgRes.blob();
  // eslint-disable-next-line no-console
  console.log(`[urlScreenshot] received ${sourceBlob.type} ${kb(sourceBlob.size)} KB`);
  // Microlink returns JPEG when we ask for it (their docs); fall back to
  // re-encoding from PNG client-side if not. The HD source kept on the
  // block (for Download) is the JPEG itself — much lighter than PNG with
  // visually identical quality for screenshot content. The display copy
  // is AVIF/WebP — 5-10× smaller again, fast IndexedDB storage + decode.
  const img = await loadImageFromBlob(sourceBlob);
  // HD copy = the original lossless PNG straight from Microlink.
  const hdBlob = sourceBlob;
  // Display copy: WebP encoded from the lossless PNG, downscaled to
  // a max 2000px wide. Our open-card width is 1000 CSS px, so 2000
  // covers 2× retina perfectly.
  const DISPLAY_MAX_W = 2000;
  const displayW = Math.min(img.naturalWidth, DISPLAY_MAX_W);
  const displayBlob = await encodeFromImage(img, displayW, [
    ["image/webp", 0.9],
  ], hdBlob);
  const aspect = img.naturalHeight / img.naturalWidth;

  return {
    block: {
      id: uuid(),
      type: "image",
      content: "",
      imageBlob: displayBlob,
      imageMimeType: displayBlob.type || "image/webp",
      imageBlobOriginal: hdBlob,
      imageMimeTypeOriginal: hdBlob.type || "image/png",
      imageAspect: aspect,
      imageSourceUrl: sourceUrl,
    },
    title: data.data.title?.trim() || null,
  };
}

export function looksLikeUrl(text: string): boolean {
  const t = text.trim();
  if (!t || t.includes("\n") || t.includes(" ")) return false;
  if (/^https?:\/\//i.test(t)) return true;
  // Bare domain (e.g. "github.com/foo") — require a TLD-ish pattern.
  return /^([a-z0-9-]+\.)+[a-z]{2,}(\/.*)?$/i.test(t);
}

function normalizeUrl(input: string): string {
  const t = input.trim();
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

async function encodeFromImage(
  img: HTMLImageElement,
  targetWidth: number,
  candidates: Array<[string, number]>,
  fallback: Blob,
): Promise<Blob> {
  const ratio = targetWidth / img.naturalWidth;
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = Math.round(img.naturalHeight * ratio);
  const ctx = canvas.getContext("2d");
  if (!ctx) return fallback;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  for (const [type, quality] of candidates) {
    const out = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, quality));
    if (out && out.type === type) {
      // eslint-disable-next-line no-console
      console.log(`[urlScreenshot] re-encoded ${kb(fallback.size)} KB → ${kb(out.size)} KB ${type} (q=${quality}, ${canvas.width}×${canvas.height})`);
      return out;
    }
  }
  return fallback;
}

function kb(bytes: number): string {
  return (bytes / 1024).toFixed(0);
}

function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Image decode failed")); };
    img.src = url;
  });
}

interface MicrolinkResponse {
  status: "success" | string;
  message?: string;
  code?: string;
  data: {
    title?: string | null;
    screenshot?: { url: string } | null;
  };
}
