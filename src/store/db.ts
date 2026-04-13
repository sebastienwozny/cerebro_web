import Dexie, { type EntityTable } from "dexie";

// ── Block types (mirrors Swift NoteBlock) ──

export type BlockType =
  | "text"
  | "heading1"
  | "heading2"
  | "heading3"
  | "bulletList"
  | "todo"
  | "quote";

export interface NoteBlock {
  id: string;
  type: BlockType;
  content: string;
  isChecked?: boolean;
}

// ── Card kind ──

export type CardKind = "note" | "image";

// ── Note model ──

export interface Note {
  id: string;
  kind: CardKind;
  title: string;
  blocks: NoteBlock[];
  imageDataUrl?: string; // base64 data URL for image cards
  imageAspect: number; // height / width
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
  }
}

export const db = new CerebroDB();
