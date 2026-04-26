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
    // `domcontentloaded` is safer than `networkidle0`: many sites fire
    // analytics/heartbeats forever, which causes networkidle0 to time out
    // and Microlink to return HTTP 500.
    waitUntil: "domcontentloaded",
    waitFor: "1500",
  });
  const apiUrl = `https://api.microlink.io/?${params.toString()}`;

  const res = await fetch(apiUrl);
  // Microlink returns a JSON body on errors too — try to surface its
  // `message` rather than just the bare HTTP status.
  let data: MicrolinkResponse | null = null;
  try { data = await res.json(); } catch { /* non-JSON response */ }
  if (!res.ok) {
    const detail = data?.message ?? data?.code ?? `HTTP ${res.status}`;
    throw new Error(`Microlink: ${detail}`);
  }
  if (!data || data.status !== "success") {
    throw new Error(data?.message ?? `Microlink ${data?.status ?? "error"}`);
  }

  const screenshotUrl = data.data.screenshot?.url;
  if (!screenshotUrl) throw new Error("No screenshot URL in Microlink response");

  const imgRes = await fetch(screenshotUrl);
  if (!imgRes.ok) throw new Error(`Screenshot fetch HTTP ${imgRes.status}`);
  const blob = await imgRes.blob();
  const dataUrl = await blobToDataUrl(blob);
  const aspect = await computeImageAspect(dataUrl);

  return {
    block: {
      id: uuid(),
      type: "image",
      content: "",
      imageDataUrl: dataUrl,
      imageAspect: aspect,
      imageSourceUrl: url,
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

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function computeImageAspect(dataUrl: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const aspect = img.naturalHeight / img.naturalWidth;
      resolve(Number.isFinite(aspect) && aspect > 0 ? aspect : 1);
    };
    img.onerror = () => reject(new Error("Failed to decode screenshot image"));
    img.src = dataUrl;
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
