import { CARD_W, CARD_H, CARD_CONTENT_W } from "../constants";
import type { Note } from "../store/db";

export function getCardSize(note: Pick<Note, "kind" | "imageAspect">) {
  const isImage = note.kind === "image";
  const w = isImage ? CARD_CONTENT_W : CARD_W;
  const h = isImage && note.imageAspect > 0 ? CARD_CONTENT_W * note.imageAspect : CARD_H;
  return { w, h };
}
