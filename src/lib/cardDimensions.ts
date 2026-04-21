import { CARD_W, CARD_H } from "../constants";
import type { Note, NoteBlock } from "../store/db";

export const IMAGE_CARD_BASE_W = 1200;

export type HeaderMedia =
  | { type: "image"; dataUrl: string; aspect: number }
  | {
      type: "video";
      blockId: string;
      posterDataUrl: string;
      aspect: number;
      videoBlob: Blob;
      videoMimeType: string;
    };

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
  if (block?.type === "image" && block.imageDataUrl) {
    return { dataUrl: block.imageDataUrl, aspect: block.imageAspect ?? 1 };
  }
  return null;
}

/** Extract header media (image OR video) from the first block. */
export function getHeaderMedia(note: Pick<Note, "blocks">): HeaderMedia | null {
  const block: NoteBlock | undefined = note.blocks[0];
  if (!block) return null;
  if (block.type === "image" && block.imageDataUrl) {
    return { type: "image", dataUrl: block.imageDataUrl, aspect: block.imageAspect ?? 1 };
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
