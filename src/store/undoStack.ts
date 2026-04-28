import type { Note } from "./db";

// ── Snapshot: complete note state for restore ──

export type NoteSnapshot = Omit<Note, "createdAt"> & { createdAt: string };

export function snapshotFromNote(note: Note): NoteSnapshot {
  return {
    ...note,
    blocks: note.blocks.map(b => ({ ...b })),
    createdAt: note.createdAt.toISOString(),
  };
}

export function noteFromSnapshot(snap: NoteSnapshot): Note {
  return {
    ...snap,
    // Strip runtime-hydrated Blob fields. The persisted form keeps only
    // the blob id refs (imageBlobId etc.); the actual Blob is re-attached
    // on the next useNotes hydration via the in-memory blob cache.
    blocks: snap.blocks.map((b) => {
      const next = { ...b };
      delete next.imageBlob;
      delete next.imageBlobOriginal;
      delete next.videoBlob;
      return next;
    }),
    createdAt: new Date(snap.createdAt),
  };
}

// ── Action types ──

export type CanvasAction =
  | { type: "move"; moves: { noteId: string; oldX: number; oldY: number }[] }
  | { type: "resize"; noteId: string; oldScale: number; oldPosX: number; oldPosY: number }
  | { type: "delete"; snapshots: NoteSnapshot[] }
  | { type: "create"; noteIds: string[] }
  | { type: "batch"; actions: CanvasAction[] };

// ── Undo stack ──

const MAX_SIZE = 50;

export class CanvasUndoStack {
  private undoStack: CanvasAction[] = [];
  private redoStack: CanvasAction[] = [];
  private listeners: Set<() => void> = new Set();

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private notify() {
    for (const fn of this.listeners) fn();
  }

  record(action: CanvasAction) {
    this.undoStack.push(action);
    if (this.undoStack.length > MAX_SIZE) this.undoStack.shift();
    this.redoStack.length = 0;
    this.notify();
  }

  popUndo(): CanvasAction | undefined {
    const action = this.undoStack.pop();
    this.notify();
    return action;
  }

  popRedo(): CanvasAction | undefined {
    const action = this.redoStack.pop();
    this.notify();
    return action;
  }

  pushRedo(action: CanvasAction) {
    this.redoStack.push(action);
    if (this.redoStack.length > MAX_SIZE) this.redoStack.shift();
    this.notify();
  }

  pushUndo(action: CanvasAction) {
    this.undoStack.push(action);
    if (this.undoStack.length > MAX_SIZE) this.undoStack.shift();
    this.notify();
  }
}
