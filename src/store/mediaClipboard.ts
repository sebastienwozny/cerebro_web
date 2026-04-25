import type { NoteBlock } from "./db";

/**
 * Module-level clipboard for an image or video block copied from the editor.
 * Used to relay the media across components: NoteEditor's BlockMenu/MediaToolbar
 * "Copy" populates it; Canvas's paste reads it to create a new card with the
 * same media as the header block.
 *
 * Separate from the system clipboard (text/html + text/plain) which is also
 * written so external apps can paste the rich content.
 */
let storedBlock: NoteBlock | null = null;

export function setMediaClipboard(block: NoteBlock | null) {
  storedBlock = block;
}

export function getMediaClipboard(): NoteBlock | null {
  return storedBlock;
}

export function clearMediaClipboard() {
  storedBlock = null;
}
