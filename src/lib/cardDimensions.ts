import { CARD_W, CARD_H } from "../constants";
import type { Note, NoteBlock } from "../store/db";
import { getImageUrl } from "./imageUrlCache";

export const IMAGE_CARD_BASE_W = 1200;

export type HeaderMedia =
  | { type: "image"; dataUrl: string; aspect: number; sourceUrl?: string }
  | {
      type: "video";
      blockId: string;
      posterDataUrl: string;
      aspect: number;
      videoBlob: Blob;
      videoMimeType: string;
    };

/** Resolve a usable `<img>` src for an image block. New blocks store the
 *  display copy as a Blob (cheaper IndexedDB roundtrip + faster decode)
 *  exposed as a session-scoped object URL. Legacy blocks still carry a
 *  base64 `imageDataUrl` and use that directly. */
function imageSrcFromBlock(block: NoteBlock): string | null {
  if (block.imageBlob) return getImageUrl(block.id, block.imageBlob);
  if (block.imageDataUrl) return block.imageDataUrl;
  return null;
}

/** Check whether a note behaves as a media card (first block is image or video). */
export function isMediaCard(note: Pick<Note, "blocks">): boolean {
  const t = note.blocks[0]?.type;
  return t === "image" || t === "video";
}

/** Back-compat: image-only predicate (first block is an image). */
export function isImageCard(note: Pick<Note, "blocks">): boolean {
  return note.blocks[0]?.type === "image";
}

/** Extract the header image data from the first block, if it's an image. */
export function getHeaderImage(note: Pick<Note, "blocks">): { dataUrl: string; aspect: number } | null {
  const block: NoteBlock | undefined = note.blocks[0];
  if (block?.type !== "image") return null;
  const src = imageSrcFromBlock(block);
  if (!src) return null;
  return { dataUrl: src, aspect: block.imageAspect ?? 1 };
}

/** Extract header media (image OR video) from the first block. */
export function getHeaderMedia(note: Pick<Note, "blocks">): HeaderMedia | null {
  const block: NoteBlock | undefined = note.blocks[0];
  if (!block) return null;
  if (block.type === "image") {
    const src = imageSrcFromBlock(block);
    if (!src) return null;
    return {
      type: "image",
      dataUrl: src,
      aspect: block.imageAspect ?? 1,
      sourceUrl: block.imageSourceUrl,
    };
  }
  if (block.type === "video" && block.videoBlob && block.videoPosterDataUrl) {
    return {
      type: "video",
      blockId: block.id,
      posterDataUrl: block.videoPosterDataUrl,
      aspect: block.videoAspect ?? 1,
      videoBlob: block.videoBlob,
      videoMimeType: block.videoMimeType ?? "video/mp4",
    };
  }
  return null;
}

export function getCardSize(note: Pick<Note, "blocks" | "cardScale">) {
  const s = note.cardScale || 1;
  const header = getHeaderMedia(note);
  const baseW = header ? IMAGE_CARD_BASE_W : CARD_W;
  const baseH = header && header.aspect > 0 ? IMAGE_CARD_BASE_W * header.aspect : CARD_H;
  return { w: baseW * s, h: baseH * s };
}

/** Width range for the hero media (image / video poster) on an open card.
 *  Endpoints are continuous: very-landscape → MAX_W, very-portrait → MIN_W. */
export const OPEN_MEDIA_MAX_W = 1080;
export const OPEN_MEDIA_MIN_W = 640;

/**
 * Compute the open-card hero media display size. `aspect = h/w`, so
 *   aspect = 0.5 (e.g. 16:9 landscape) maps to MAX_W,
 *   aspect = 1.5 (e.g. 2:3 portrait)  maps to MIN_W,
 *   anything beyond either end is clamped.
 *
 * Caps:
 *   - width never exceeds the viewport (with 80px margins).
 *   - height never exceeds 75vh — for very tall portraits the width is
 *     scaled back so the text below the hero stays visible.
 */
export function getOpenMediaSize(
  aspect: number,
  windowW: number,
  windowH: number,
): { width: number; height: number } {
  const t = Math.max(0, Math.min(1, aspect - 0.5));
  let width = OPEN_MEDIA_MAX_W * (1 - t) + OPEN_MEDIA_MIN_W * t;
  width = Math.min(width, windowW - 80);
  const maxH = windowH * 0.75;
  if (width * aspect > maxH) width = maxH / aspect;
  // Floor: never narrower than the text reading column. Tall portraits
  // beyond `maxH` are allowed to overflow vertically — the open card
  // scrolls — rather than collapsing to a sub-text-width sliver.
  width = Math.max(width, OPEN_MEDIA_MIN_W);
  return { width, height: width * aspect };
}
