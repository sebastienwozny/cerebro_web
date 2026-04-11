import { useEffect } from "react";
import type { Note } from "../store/db";
import { DELETE_DURATION } from "../constants";
import { snapshotFromNote, type CanvasAction } from "../store/undoStack";

interface UseKeyboardShortcutsOptions {
  notes: Note[];
  canvasLocked: boolean;
  selectedIds: Set<string>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setDeletingIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  closeNote: () => void;
  clearSelection: () => void;
  selectAll: () => void;
  deleteNote: (id: string) => void;
  openNote: (id: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  recordAction: (action: CanvasAction) => void;
}

export function useKeyboardShortcuts({
  notes,
  canvasLocked,
  selectedIds,
  setSelectedIds,
  setDeletingIds,
  closeNote,
  clearSelection,
  selectAll,
  deleteNote,
  openNote,
  onUndo,
  onRedo,
  recordAction,
}: UseKeyboardShortcutsOptions) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Undo/Redo — only when no card is open (text editing has its own undo)
      if (e.key === "z" && (e.metaKey || e.ctrlKey) && !canvasLocked) {
        e.preventDefault();
        if (e.shiftKey) onRedo();
        else onUndo();
        return;
      }
      if (canvasLocked) {
        if (e.key === "Escape") closeNote();
        return;
      }
      if (e.key === "Escape") {
        clearSelection();
        return;
      }
      if ((e.key === "Backspace" || e.key === "Delete") && selectedIds.size > 0) {
        e.preventDefault();
        const toDelete = new Set(selectedIds);
        // Record snapshots for undo before deleting
        const snapshots = notes
          .filter(n => toDelete.has(n.id))
          .map(snapshotFromNote);
        recordAction({ type: "delete", snapshots });
        setDeletingIds(toDelete);
        setSelectedIds(new Set());
        setTimeout(() => {
          for (const id of toDelete) deleteNote(id);
          setDeletingIds(new Set());
        }, DELETE_DURATION * 1000);
        return;
      }
      if (e.key === "a" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        selectAll();
        return;
      }
      if (e.key === "Tab" && notes.length > 0) {
        e.preventDefault();
        const sorted = [...notes].sort((a, b) => a.positionX - b.positionX || a.positionY - b.positionY);
        const ids = sorted.map(n => n.id);
        const lastSelected = ids.find(id => selectedIds.has(id));
        const currentIdx = lastSelected ? ids.indexOf(lastSelected) : -1;
        const nextIdx = e.shiftKey
          ? (currentIdx <= 0 ? ids.length - 1 : currentIdx - 1)
          : (currentIdx + 1) % ids.length;
        setSelectedIds(new Set([ids[nextIdx]]));
        return;
      }
      if ((e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "ArrowDown") && selectedIds.size > 0) {
        e.preventDefault();
        const selected = notes.filter(n => selectedIds.has(n.id));
        const anchor = selected[0];
        if (!anchor) return;
        const others = notes.filter(n => !selectedIds.has(n.id));
        if (others.length === 0) return;
        const horizontal = e.key === "ArrowRight" || e.key === "ArrowLeft";
        let best: typeof notes[0] | null = null;
        let bestScore = Infinity;
        for (const n of others) {
          const dx = n.positionX - anchor.positionX;
          const dy = n.positionY - anchor.positionY;
          let valid = false;
          if (e.key === "ArrowRight" && dx > 0) valid = true;
          if (e.key === "ArrowLeft" && dx < 0) valid = true;
          if (e.key === "ArrowDown" && dy > 0) valid = true;
          if (e.key === "ArrowUp" && dy < 0) valid = true;
          if (!valid) continue;
          const score = horizontal
            ? Math.abs(dx) + Math.abs(dy) * 3
            : Math.abs(dy) + Math.abs(dx) * 3;
          if (score < bestScore) { bestScore = score; best = n; }
        }
        if (best) {
          if (e.shiftKey) {
            setSelectedIds(prev => { const next = new Set(prev); next.add(best!.id); return next; });
          } else {
            setSelectedIds(new Set([best.id]));
          }
        }
        return;
      }
      if (e.key === "Enter" && selectedIds.size === 1) {
        const noteId = [...selectedIds][0];
        clearSelection();
        openNote(noteId);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canvasLocked, closeNote, clearSelection, selectedIds, deleteNote, setSelectedIds, setDeletingIds, selectAll, notes, openNote, onUndo, onRedo, recordAction]);
}
