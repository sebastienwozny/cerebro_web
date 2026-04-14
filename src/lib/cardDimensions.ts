import { CARD_W, CARD_H } from "../constants";
import type { Note, NoteBlock } from "../store/db";

export const IMAGE_CARD_BASE_W = 1200;

/** Check whether a note behaves as an image card (first block is an image). */
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

export function getCardSize(note: Pick<Note, "blocks" | "cardScale">) {
  const s = note.cardScale || 1;
  const header = getHeaderImage(note);
  const baseW = header ? IMAGE_CARD_BASE_W : CARD_W;
  const baseH = header && header.aspect > 0 ? IMAGE_CARD_BASE_W * header.aspect : CARD_H;
  return { w: baseW * s, h: baseH * s };
}
