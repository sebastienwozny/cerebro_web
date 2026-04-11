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

  async function addNote(x: number, y: number): Promise<Note> {
    const maxZ = getMaxZ(notes);
    const note: Note = {
      id: uuid(),
      kind: "note",
      title: "",
      blocks: [makeBlock("heading1")],
      imageAspect: 0,
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

  async function bringToFront(id: string) {
    const maxZ = getMaxZ(notes);
    await db.notes.update(id, { zOrder: maxZ + 1 });
  }

  return { notes, addNote, updateNote, deleteNote, bringToFront };
}
