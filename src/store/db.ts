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
  imageDataUrl?: string; // base64 data URL (legacy image blocks)
  /** ID into the `blobs` table for the display image. The actual Blob is
   *  attached at runtime as `imageBlob` after hydration in useNotes. */
  imageBlobId?: string;
  imageMimeType?: string; // e.g. "image/webp"
  imageAspect?: number;   // height / width
  imageSourceUrl?: string;
  /** ID into the `blobs` table for the optional full-fidelity copy. */
  imageBlobOriginalId?: string;
  imageMimeTypeOriginal?: string;
  imageDataUrlOriginal?: string;
  codeLanguage?: string;
  codeWrap?: boolean;
  /** ID into the `blobs` table for the video file. */
  videoBlobId?: string;
  videoPosterDataUrl?: string;
  videoAspect?: number;
  videoMimeType?: string;
  // ── Runtime-hydrated (not persisted as inline in the notes table) ──
  // useNotes attaches these from the blobs table on load. Downstream
  // consumers (PVP, imageUrlCache, etc.) keep reading them as before.
  // Don't set these at write time — call storeBlob() and store the id.
  imageBlob?: Blob;
  imageBlobOriginal?: Blob;
  videoBlob?: Blob;
}

// ── Note model ──

export interface Note {
  id: string;
  title: string;
  blocks: NoteBlock[];
  cardScale: number;
  positionX: number;
  positionY: number;
  zOrder: number;
  createdAt: Date;
}

// ── Blob storage (separate table) ──
//
// Blobs live here so the `notes` table never has to re-serialize a Blob
// on a scalar update (drag, zOrder, resize…). That avoids Safari's
// "Error preparing Blob/File data" bug, which was silently corrupting
// images/videos on every position write.

export interface BlobRow {
  id: string;
  data: Blob;
  mimeType: string;
}

// ── Database ──

class CerebroDB extends Dexie {
  notes!: EntityTable<Note, "id">;
  blobs!: EntityTable<BlobRow, "id">;

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
    // v4: split inline Blob fields out of the notes table into a separate
    // `blobs` table. Notes now reference blobs by id. Frequent scalar
    // updates on notes no longer touch any Blob serialization path —
    // fixing Safari's "preparing Blob/File" corruption.
    this.version(4).stores({
      notes: "id, zOrder, createdAt",
      blobs: "id",
    }).upgrade(async tx => {
      const blobsToAdd: BlobRow[] = [];
      await tx.table("notes").toCollection().modify(note => {
        note.blocks = note.blocks.map((b: NoteBlock & {
          imageBlob?: Blob;
          imageBlobOriginal?: Blob;
          videoBlob?: Blob;
        }) => {
          const next: NoteBlock = { ...b };
          if (b.imageBlob instanceof Blob) {
            const id = crypto.randomUUID();
            blobsToAdd.push({ id, data: b.imageBlob, mimeType: b.imageMimeType ?? b.imageBlob.type ?? "" });
            next.imageBlobId = id;
          }
          if (b.imageBlobOriginal instanceof Blob) {
            const id = crypto.randomUUID();
            blobsToAdd.push({ id, data: b.imageBlobOriginal, mimeType: b.imageMimeTypeOriginal ?? b.imageBlobOriginal.type ?? "" });
            next.imageBlobOriginalId = id;
          }
          if (b.videoBlob instanceof Blob) {
            const id = crypto.randomUUID();
            blobsToAdd.push({ id, data: b.videoBlob, mimeType: b.videoMimeType ?? b.videoBlob.type ?? "" });
            next.videoBlobId = id;
          }
          // Drop the inline Blob fields; they're now in the blobs table.
          delete next.imageBlob;
          delete next.imageBlobOriginal;
          delete next.videoBlob;
          return next;
        });
      });
      if (blobsToAdd.length > 0) {
        await tx.table("blobs").bulkAdd(blobsToAdd);
      }
    });
  }
}

export const db = new CerebroDB();

// ── In-memory blob cache ──
//
// Filled at app boot by `preloadAllBlobs()` and updated in lockstep with
// storeBlob/deleteBlob. Lets useNotes hydrate inline Blob fields
// synchronously per render, preserving the API the rest of the codebase
// expects.

const blobMemoryCache = new Map<string, Blob>();

export async function preloadAllBlobs(): Promise<void> {
  const rows = await db.blobs.toArray();
  for (const row of rows) blobMemoryCache.set(row.id, row.data);
}

export function getCachedBlob(id: string): Blob | undefined {
  return blobMemoryCache.get(id);
}

export async function storeBlob(blob: Blob, mimeType?: string): Promise<string> {
  const id = crypto.randomUUID();
  const row: BlobRow = { id, data: blob, mimeType: mimeType ?? blob.type ?? "" };
  await db.blobs.add(row);
  blobMemoryCache.set(id, blob);
  return id;
}

export async function deleteBlob(id: string): Promise<void> {
  await db.blobs.delete(id);
  blobMemoryCache.delete(id);
}

/** Wraps `db.notes.update` to swallow Safari's intermittent
 *  "Error preparing Blob/File" errors. With v4 the Note record itself no
 *  longer carries Blobs so this should rarely fire — keep it as a safety
 *  net for browser-level edge cases. */
export async function safeUpdateNote(id: string, changes: Partial<Note>): Promise<void> {
  try {
    await db.notes.update(id, changes);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/preparing\s+blob|blob\/file/i.test(msg)) throw e;
    console.warn(`safeUpdateNote(${id}): Safari blob/file error, dropping update`, e);
  }
}
