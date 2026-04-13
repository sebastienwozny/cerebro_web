import { CARD_W, CARD_H } from "../constants";
import type { Note } from "../store/db";

export const IMAGE_CARD_BASE_W = 1200;

export function getCardSize(note: Pick<Note, "kind" | "imageAspect" | "cardScale">) {
  const s = note.cardScale || 1;
  const isImage = note.kind === "image";
  const baseW = isImage ? IMAGE_CARD_BASE_W : CARD_W;
  const baseH = isImage && note.imageAspect > 0 ? IMAGE_CARD_BASE_W * note.imageAspect : CARD_H;
  return { w: baseW * s, h: baseH * s };
}
