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
  }
}

export const db = new CerebroDB();
