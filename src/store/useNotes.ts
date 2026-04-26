import { useEffect, useRef } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { v4 as uuid } from "uuid";
import { db, type Note, type NoteBlock } from "./db";

function makeBlock(type: NoteBlock["type"] = "text"): NoteBlock {
  return { id: uuid(), type, content: "" };
}

function getMaxZ(notes: Note[]): number {
  return notes.length > 0 ? Math.max(...notes.map((n) => n.zOrder)) : 0;
}

export function useNotes() {
  const notes = useLiveQuery(() => db.notes.orderBy("zOrder").toArray()) ?? [];

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
        for (const n of sorted) await db.notes.update(n.id, { zOrder: z++ });
      });
    }
  }, [notes]);

  async function addNote(
    x: number,
    y: number,
    id?: string,
    initialMediaBlock?: NoteBlock,
  ): Promise<Note> {
    const maxZ = getMaxZ(notes);
    const blocks: NoteBlock[] = initialMediaBlock
      ? [initialMediaBlock, makeBlock("text")]
      : [makeBlock("heading1")];
    const note: Note = {
      id: id ?? uuid(),
      title: "",
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
    await db.notes.update(id, changes);
  }

  async function deleteNote(id: string) {
    await db.notes.delete(id);
  }

  async function duplicateNote(source: Note, zOrder?: number): Promise<Note> {
    const copy: Note = {
      ...source,
      id: uuid(),
      blocks: source.blocks.map(b => ({ ...b, id: uuid() })),
      zOrder: zOrder ?? source.zOrder,
      createdAt: new Date(),
    };
    await db.notes.add(copy);
    return copy;
  }

  async function bringToFront(id: string) {
    const maxZ = getMaxZ(notes);
    // Renormalize when zOrder gets too close to the body backdrop's z-index
    // (9998). Without a cap, repeated bringToFront calls eventually push
    // cards above the backdrop, leaking through the white overlay when a
    // card is open. Renormalize to consecutive integers preserving order.
    if (maxZ > 8000) {
      const sorted = [...notes].sort((a, b) => a.zOrder - b.zOrder);
      await db.transaction("rw", db.notes, async () => {
        let z = 1;
        for (const n of sorted) {
          if (n.id === id) continue;
          await db.notes.update(n.id, { zOrder: z++ });
        }
        await db.notes.update(id, { zOrder: z });
      });
      return;
    }
    await db.notes.update(id, { zOrder: maxZ + 1 });
  }

  return { notes, addNote, updateNote, deleteNote, duplicateNote, bringToFront };
}
