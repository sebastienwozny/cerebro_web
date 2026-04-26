import Dexie, { type EntityTable } from "dexie";

// ── Block types ──

export type BlockType =
  | "text"
  | "heading1"
  | "heading2"
  | "heading3"
  | "bulletList"
  | "orderedList"
  | "todo"
  | "quote"
  | "codeBlock"
  | "hr"
  | "image"
  | "video";

export interface NoteBlock {
  id: string;
  type: BlockType;
  content: string;
  isChecked?: boolean;
  imageDataUrl?: string; // base64 data URL (image blocks)
  imageAspect?: number;  // height / width  (image blocks)
  imageSourceUrl?: string; // origin URL for screenshot-from-URL cards
                           // (used to flag the card as "URL screenshot" so
                           //  the canvas drops the rounded corners)
  codeLanguage?: string; // hljs language id (codeBlock blocks)
  codeWrap?: boolean;    // wrap long lines instead of horizontal scroll
  // Video blocks store the media as a Blob (binary) in IndexedDB to avoid
  // the 33% base64 overhead and keep large files out of TipTap's doc state.
  videoBlob?: Blob;
  videoPosterDataUrl?: string; // base64 poster image (thumbnail frame)
  videoAspect?: number;        // height / width
  videoMimeType?: string;      // e.g. "video/mp4"
}

// ── Note model ──

export interface Note {
  id: string;
  title: string;
  blocks: NoteBlock[];
  cardScale: number; // resize factor (default 1)
  positionX: number;
  positionY: number;
  zOrder: number;
  createdAt: Date;
}

// ── Database ──

class CerebroDB extends Dexie {
  notes!: EntityTable<Note, "id">;

  constructor() {
    super("cerebro");
    this.version(1).stores({
      notes: "id, zOrder, createdAt",
    });
    this.version(2).stores({
      notes: "id, zOrder, createdAt",
    }).upgrade(tx => {
      return tx.table("notes").toCollection().modify(note => {
        if (note.cardScale === undefined || note.kind === "note") {
          note.cardScale = 1;
        }
      });
    });
    this.version(3).stores({
      notes: "id, zOrder, createdAt",
    }).upgrade(tx => {
      return tx.table("notes").toCollection().modify(note => {
        // Migrate image cards: move image data into a block
        if (note.kind === "image" && note.imageDataUrl) {
          const imageBlock = {
            id: crypto.randomUUID(),
            type: "image",
            content: "",
            imageDataUrl: note.imageDataUrl,
            imageAspect: note.imageAspect || 1,
          };
          note.blocks = [imageBlock, ...note.blocks];
        }
        delete note.kind;
        delete note.imageDataUrl;
        delete note.imageAspect;
      });
    });
  }
}

export const db = new CerebroDB();
