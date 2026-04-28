import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { v4 as uuid } from "uuid";
import { db, getCachedBlob, preloadAllBlobs, safeUpdateNote, storeBlob, type Note, type NoteBlock } from "./db";

function makeBlock(type: NoteBlock["type"] = "text"): NoteBlock {
  return { id: uuid(), type, content: "" };
}

function getMaxZ(notes: Note[]): number {
  return notes.length > 0 ? Math.max(...notes.map((n) => n.zOrder)) : 0;
}

/** Hydrate a persisted note: attach inline `imageBlob`/`videoBlob` fields
 *  from the in-memory blob cache so downstream code reads them as before.
 *  If a referenced blob isn't in cache yet (preload still in flight), the
 *  field stays undefined; useNotes triggers a re-render once preload
 *  completes and hydration tries again. */
function hydrateNote(note: Note): Note {
  return {
    ...note,
    blocks: note.blocks.map((b) => ({
      ...b,
      imageBlob: b.imageBlobId ? getCachedBlob(b.imageBlobId) : undefined,
      imageBlobOriginal: b.imageBlobOriginalId ? getCachedBlob(b.imageBlobOriginalId) : undefined,
      videoBlob: b.videoBlobId ? getCachedBlob(b.videoBlobId) : undefined,
    })),
  };
}

/** Strip the runtime-only Blob fields and ensure any unsaved blobs are
 *  written to the blobs table first (replacing them with id refs). Called
 *  before persisting any block to the notes table. */
async function persistBlock(block: NoteBlock): Promise<NoteBlock> {
  const out: NoteBlock = { ...block };
  if (block.imageBlob && !block.imageBlobId) {
    out.imageBlobId = await storeBlob(block.imageBlob, block.imageMimeType);
  }
  if (block.imageBlobOriginal && !block.imageBlobOriginalId) {
    out.imageBlobOriginalId = await storeBlob(block.imageBlobOriginal, block.imageMimeTypeOriginal);
  }
  if (block.videoBlob && !block.videoBlobId) {
    out.videoBlobId = await storeBlob(block.videoBlob, block.videoMimeType);
  }
  delete out.imageBlob;
  delete out.imageBlobOriginal;
  delete out.videoBlob;
  return out;
}

let preloadPromise: Promise<void> | null = null;
function ensurePreload(): Promise<void> {
  if (!preloadPromise) preloadPromise = preloadAllBlobs();
  return preloadPromise;
}

export function useNotes() {
  const [preloaded, setPreloaded] = useState(false);
  useEffect(() => {
    ensurePreload().then(() => setPreloaded(true));
  }, []);

  const rawNotes = useLiveQuery(() => db.notes.orderBy("zOrder").toArray()) ?? [];

  // Re-hydrate when notes change OR when preload completes (so blobs that
  // weren't cached on first render get attached on the next).
  const notes = useMemo(
    () => rawNotes.map(hydrateNote),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rawNotes, preloaded],
  );

  // One-time zOrder compaction on first load. Existing data may have
  // accumulated zOrders far above the body backdrop's z-index (9998) from
  // years of bringToFront calls — those cards leak above the overlay when
  // another card opens. Renormalize once when notes first arrive.
  const compactedRef = useRef(false);
  useEffect(() => {
    if (compactedRef.current || notes.length === 0) return;
    compactedRef.current = true;
    if (getMaxZ(notes) > 8000) {
      const sorted = [...notes].sort((a, b) => a.zOrder - b.zOrder);
      db.transaction("rw", db.notes, async () => {
        let z = 1;
        for (const n of sorted) await safeUpdateNote(n.id, { zOrder: z++ });
      });
    }
  }, [notes]);

  async function addNote(
    x: number,
    y: number,
    id?: string,
    initialMediaBlock?: NoteBlock,
    initialTitle?: string,
    initialSecondBlock?: NoteBlock,
  ): Promise<Note> {
    const maxZ = getMaxZ(notes);
    const titleBlock: NoteBlock = initialSecondBlock
      ? initialSecondBlock
      : initialTitle
        ? { ...makeBlock("heading1"), content: initialTitle }
        : makeBlock("text");
    const rawBlocks: NoteBlock[] = initialMediaBlock
      ? [initialMediaBlock, titleBlock]
      : [makeBlock("heading1")];
    // Store any inline blobs in the blobs table and replace with id refs
    // before writing to the notes table.
    const blocks = await Promise.all(rawBlocks.map(persistBlock));
    const note: Note = {
      id: id ?? uuid(),
      title: initialTitle ?? "",
      blocks,
      cardScale: 1,
      positionX: x,
      positionY: y,
      zOrder: maxZ + 1,
      createdAt: new Date(),
    };
    await db.notes.add(note);
    return note;
  }

  async function updateNote(id: string, changes: Partial<Note>) {
    // If the caller passes new blocks, persist any inline blobs first.
    if (changes.blocks) {
      changes = { ...changes, blocks: await Promise.all(changes.blocks.map(persistBlock)) };
    }
    await safeUpdateNote(id, changes);
  }

  async function deleteNote(id: string) {
    // Note: orphaned blobs from this note's blocks are intentionally left
    // in the blobs table. Deleting them on note delete would break
    // duplicates (which share blob ids). A periodic GC can sweep them
    // later; for now the leak is bounded and harmless.
    await db.notes.delete(id);
  }

  async function duplicateNote(source: Note, zOrder?: number): Promise<Note> {
    const copy: Note = {
      ...source,
      id: uuid(),
      blocks: source.blocks.map((b) => {
        const next: NoteBlock = { ...b, id: uuid() };
        // Drop runtime hydrated fields; the persisted form keeps the same
        // blobBlobId refs so the duplicate shares storage with the source.
        delete next.imageBlob;
        delete next.imageBlobOriginal;
        delete next.videoBlob;
        return next;
      }),
      zOrder: zOrder ?? source.zOrder,
      createdAt: new Date(),
    };
    await db.notes.add(copy);
    return copy;
  }

  async function bringToFront(id: string) {
    const maxZ = getMaxZ(notes);
    if (maxZ > 8000) {
      const sorted = [...notes].sort((a, b) => a.zOrder - b.zOrder);
      await db.transaction("rw", db.notes, async () => {
        let z = 1;
        for (const n of sorted) {
          if (n.id === id) continue;
          await safeUpdateNote(n.id, { zOrder: z++ });
        }
        await safeUpdateNote(id, { zOrder: z });
      });
      return;
    }
    await safeUpdateNote(id, { zOrder: maxZ + 1 });
  }

  return { notes, addNote, updateNote, deleteNote, duplicateNote, bringToFront };
}
