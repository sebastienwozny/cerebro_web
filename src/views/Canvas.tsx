import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNotes } from "../store/useNotes";
import { db, type Note, type NoteBlock } from "../store/db";
import { useCanvas } from "../store/useCanvas";
import { useOpenClose } from "../hooks/useOpenClose";
import { useSpacePan } from "../hooks/useSpacePan";
import { useWheelNavigation } from "../hooks/useWheelNavigation";
import { useSelection } from "../hooks/useSelection";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { useWindowSize } from "../hooks/useWindowSize";
import { useCanvasMediaImport } from "../hooks/useCanvasMediaImport";
import { CanvasUndoStack, snapshotFromNote, noteFromSnapshot, type CanvasAction } from "../store/undoStack";
import gsap from "gsap";
import { DELETE_DURATION, CARD_W, GRID_GAP } from "../constants";
import { getCardSize, getHeaderMedia } from "../lib/cardDimensions";
import NoteCard from "../components/NoteCard";
import NoteEditor from "../components/NoteEditor";
import NotePreview from "../components/NotePreview";
import ContextMenu, { MOD, type MenuItem } from "../components/ContextMenu";
import {
  Copy,
  Trash2,
  LayoutGrid,
} from "lucide-react";

const undoStack = new CanvasUndoStack();
const ZERO_DELTA = { dx: 0, dy: 0 };
const NOOP_ID = () => {};

/** TipTap init is synchronous and heavy; for video cards we defer mounting the
 *  editor until the open animation has finished, so the opening frames don't
 *  stutter. Once mounted, it stays mounted through close (ref stickiness) — the
 *  open card itself unmounts at openProgress=0, which resets this state. */
function OpenCardContent({
  note, openProgress, updateNote,
}: {
  note: Note;
  openProgress: number;
  updateNote: (id: string, updates: Partial<Note>) => Promise<void>;
}) {
  const isVideoNote = getHeaderMedia(note)?.type === "video";
  const [editorReady, setEditorReady] = useState(!isVideoNote);
  useEffect(() => {
    if (!editorReady && openProgress >= 1) setEditorReady(true);
  }, [openProgress, editorReady]);
  if (!editorReady) return null;
  return (
    <NoteEditor
      blocks={note.blocks}
      onUpdate={(blocks) => {
        const title = blocks.find(b => b.type !== "image" && b.type !== "video")?.content ?? "";
        updateNote(note.id, { blocks, title });
      }}
      editable={openProgress >= 1}
    />
  );
}

export default function Canvas() {
  const { notes, addNote, updateNote, deleteNote, duplicateNote, bringToFront } = useNotes();
  const { transformRef, transformVersion, layerRef, pan, zoom, getTransform, applyTransform } = useCanvas();
  void transformVersion;
  const containerRef = useRef<HTMLDivElement>(null);
  const windowSize = useWindowSize();

  const { openNoteId, openProgress, isClosing, closingScrollOffset, openTransform, openNote, closeNote } =
    useOpenClose(bringToFront, getTransform);

  const canvasLocked = openNoteId !== null;
  const { spaceHeld, handlePointerDown: spacePanDown, handlePointerMove: spacePanMove, handlePointerUp: spacePanUp } =
    useSpacePan(canvasLocked, pan, getTransform);

  useWheelNavigation(containerRef, canvasLocked, windowSize.w, windowSize.h, pan, zoom);

  const {
    selectedIds, setSelectedIds, marquee,
    selectNote, clearSelection, selectAll, handleMarqueeDown,
  } = useSelection(notes, canvasLocked, getTransform, windowSize.w, windowSize.h);

  // Delete animation state
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [popIds, setPopIds] = useState<Set<string>>(new Set());
  const popTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const triggerPop = useCallback((ids: string[]) => {
    setPopIds(prev => { const next = new Set(prev); for (const id of ids) next.add(id); return next; });
    clearTimeout(popTimerRef.current);
    popTimerRef.current = setTimeout(() => setPopIds(new Set()), 400);
  }, []);
  const [animatingIds, setAnimatingIds] = useState<Set<string>>(new Set());

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; noteId: string | null } | null>(null);

  // Clipboard for copy/paste
  const clipboardRef = useRef<Note[]>([]);

  // Group drag state
  const [groupDragDelta, setGroupDragDelta] = useState({ dx: 0, dy: 0 });
  const [groupDragRotation, setGroupDragRotation] = useState(0);
  const groupDragDeltaRef = useRef({ dx: 0, dy: 0 });
  const groupDragRafRef = useRef(0);
  // Resize override — visual-only scale/position while the user is resizing a
  // card, so per-frame pointer moves don't hit Dexie (which would re-read every
  // note, including large video Blobs, and stall the main thread).
  const [resizeOverride, setResizeOverride] = useState<{ noteId: string; cardScale: number; positionX: number; positionY: number } | null>(null);
  const resizeOverrideRef = useRef<typeof resizeOverride>(null);
  const resizeRafRef = useRef(0);
  // Stores start positions for ALL cards in the group (leader + followers)
  const groupDragStartRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const leadStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragDuplicateIdsRef = useRef<string[]>([]);

  // Initialize both canvas layer and pvp-portal-root transforms before first paint.
  useLayoutEffect(() => { applyTransform(); }, [applyTransform]);

  // Keep notes ref current for undo/redo
  const notesRef = useRef(notes);
  notesRef.current = notes;

  const applyInverse = useCallback(async (action: CanvasAction): Promise<CanvasAction> => {
    switch (action.type) {
      case "move": {
        // Capture current positions, then restore old ones
        const currentNotes = notesRef.current;
        const inverse: CanvasAction = {
          type: "move",
          moves: action.moves.map(m => {
            const note = currentNotes.find(n => n.id === m.noteId);
            return { noteId: m.noteId, oldX: note?.positionX ?? m.oldX, oldY: note?.positionY ?? m.oldY };
          }),
        };
        // Enable transition before updating positions
        const moveIds = new Set(action.moves.map(m => m.noteId));
        setAnimatingIds(moveIds);
        await db.transaction("rw", db.notes, async () => {
          for (const m of action.moves) {
            await db.notes.update(m.noteId, { positionX: m.oldX, positionY: m.oldY });
          }
        });
        // Wait for CSS transition to complete
        await new Promise(r => setTimeout(r, 380));
        setAnimatingIds(new Set());
        return inverse;
      }
      case "delete": {
        // Re-create deleted notes
        const ids = action.snapshots.map(s => s.id);
        const inverse: CanvasAction = { type: "create", noteIds: ids };
        await db.transaction("rw", db.notes, async () => {
          for (const snap of action.snapshots) {
            await db.notes.add(noteFromSnapshot(snap));
          }
        });
        // Pop animation on restored cards
        triggerPop(ids);
        return inverse;
      }
      case "resize": {
        const currentNote = notesRef.current.find(n => n.id === action.noteId);
        const currentScale = currentNote?.cardScale ?? action.oldScale;
        const currentPosX = currentNote?.positionX ?? action.oldPosX;
        const currentPosY = currentNote?.positionY ?? action.oldPosY;
        const inverse: CanvasAction = { type: "resize", noteId: action.noteId, oldScale: currentScale, oldPosX: currentPosX, oldPosY: currentPosY };
        const obj = { scale: currentScale, posX: currentPosX, posY: currentPosY };
        await new Promise<void>(resolve => {
          gsap.to(obj, {
            scale: action.oldScale,
            posX: action.oldPosX,
            posY: action.oldPosY,
            duration: 0.35,
            ease: "power2.out",
            onUpdate: () => { db.notes.update(action.noteId, { cardScale: obj.scale, positionX: obj.posX, positionY: obj.posY }); },
            onComplete: resolve,
          });
        });
        return inverse;
      }
      case "create": {
        // Snapshot then delete created notes with animation
        const currentNotes = notesRef.current;
        const snapshots = action.noteIds
          .map(id => currentNotes.find(n => n.id === id))
          .filter((n): n is Note => n !== undefined)
          .map(snapshotFromNote);
        const inverse: CanvasAction = { type: "delete", snapshots };
        const deleteSet = new Set(action.noteIds);
        setDeletingIds(deleteSet);
        await new Promise(r => setTimeout(r, DELETE_DURATION * 1000));
        await db.transaction("rw", db.notes, async () => {
          for (const id of action.noteIds) {
            await db.notes.delete(id);
          }
        });
        setDeletingIds(new Set());
        return inverse;
      }
      case "batch": {
        // Apply all sub-actions in reverse order
        const inverses: CanvasAction[] = [];
        for (let i = action.actions.length - 1; i >= 0; i--) {
          inverses.push(await applyInverse(action.actions[i]));
        }
        return { type: "batch", actions: inverses };
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `triggerPop` is stable (ref-backed setTimeout + useState setter)
  }, []);

  const performUndo = useCallback(async () => {
    const action = undoStack.popUndo();
    if (!action) return;
    const inverse = await applyInverse(action);
    undoStack.pushRedo(inverse);
  }, [applyInverse]);

  const performRedo = useCallback(async () => {
    const action = undoStack.popRedo();
    if (!action) return;
    const inverse = await applyInverse(action);
    undoStack.pushUndo(inverse);
  }, [applyInverse]);

  const reorderSelected = useCallback(async () => {
    const selected = notes.filter(n => selectedIds.has(n.id));
    if (selected.length < 2) return;

    // Record old positions for undo
    const moves = selected.map(n => ({ noteId: n.id, oldX: n.positionX, oldY: n.positionY }));

    // Barycenter
    const cx = selected.reduce((s, n) => s + n.positionX, 0) / selected.length;
    const cy = selected.reduce((s, n) => s + n.positionY, 0) / selected.length;

    // Sort left-to-right by current position
    const sorted = [...selected].sort((a, b) => {
      if (Math.abs(a.positionX - b.positionX) > CARD_W / 4) return a.positionX - b.positionX;
      return a.positionY - b.positionY;
    });

    // Compute sizes and total width
    const sizes = sorted.map(n => getCardSize(n));
    const totalW = sizes.reduce((s, sz) => s + sz.w, 0) + (sorted.length - 1) * GRID_GAP;
    const maxH = Math.max(...sizes.map(sz => sz.h));

    // Enable CSS transition
    setAnimatingIds(new Set(selected.map(n => n.id)));

    // Place cards in a row: tops aligned, equal gaps, centered on barycenter
    let cursor = -totalW / 2;
    await db.transaction("rw", db.notes, async () => {
      for (let i = 0; i < sorted.length; i++) {
        const sz = sizes[i];
        await db.notes.update(sorted[i].id, {
          positionX: cx + cursor + sz.w / 2,
          positionY: cy + maxH / 2 - sz.h / 2,
        });
        cursor += sz.w + GRID_GAP;
      }
    });

    // Wait for CSS transition to complete
    await new Promise(r => setTimeout(r, 380));
    setAnimatingIds(new Set());

    undoStack.record({ type: "move", moves });
  }, [notes, selectedIds]);

  // Duplicate selected cards in place (offset slightly)
  const duplicateSelected = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const selected = notes.filter(n => selectedIds.has(n.id));
    const maxZ = Math.max(...notes.map(n => n.zOrder), 0);
    const createdIds: string[] = [];
    const offset = 30;
    await db.transaction("rw", db.notes, async () => {
      let z = maxZ + 1;
      for (const note of selected) {
        const copy = await duplicateNote(
          { ...note, positionX: note.positionX + offset, positionY: note.positionY + offset },
          z++,
        );
        createdIds.push(copy.id);
      }
    });
    undoStack.record({ type: "create", noteIds: createdIds });
    triggerPop(createdIds);
    setSelectedIds(new Set(createdIds));
  }, [notes, selectedIds, duplicateNote, triggerPop, setSelectedIds]);

  // Copy selected cards to clipboard
  const copySelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    clipboardRef.current = notes.filter(n => selectedIds.has(n.id));
  }, [notes, selectedIds]);

  // Paste cards from clipboard at viewport center
  const pasteClipboard = useCallback(async () => {
    const source = clipboardRef.current;
    if (source.length === 0) return;
    const t = getTransform();
    const centerX = -t.offsetX / t.scale;
    const centerY = -t.offsetY / t.scale;
    // Compute barycenter of copied cards to offset paste around viewport center
    const srcCx = source.reduce((s, n) => s + n.positionX, 0) / source.length;
    const srcCy = source.reduce((s, n) => s + n.positionY, 0) / source.length;
    const maxZ = Math.max(...notes.map(n => n.zOrder), 0);
    const createdIds: string[] = [];
    await db.transaction("rw", db.notes, async () => {
      let z = maxZ + 1;
      for (const note of source) {
        const copy = await duplicateNote(
          {
            ...note,
            positionX: centerX + (note.positionX - srcCx),
            positionY: centerY + (note.positionY - srcCy),
          },
          z++,
        );
        createdIds.push(copy.id);
      }
    });
    undoStack.record({ type: "create", noteIds: createdIds });
    triggerPop(createdIds);
    setSelectedIds(new Set(createdIds));
  }, [notes, duplicateNote, triggerPop, setSelectedIds, getTransform]);

  useKeyboardShortcuts({
    notes, canvasLocked, selectedIds, setSelectedIds, setDeletingIds,
    closeNote, clearSelection, selectAll, deleteNote, openNote,
    reorderSelected, duplicateSelected, copySelected, pasteClipboard,
    onUndo: performUndo, onRedo: performRedo,
    recordAction: undoStack.record.bind(undoStack),
  });

  // Create a new note (with optional media header block) at canvas coords,
  // record for undo.
  const createNoteAt = useCallback(
    async (canvasX: number, canvasY: number, initialMediaBlock?: NoteBlock) => {
      const noteId = crypto.randomUUID();
      triggerPop([noteId]);
      undoStack.record({ type: "create", noteIds: [noteId] });
      await addNote(canvasX, canvasY, noteId, initialMediaBlock);
    },
    [addNote, triggerPop]
  );

  const createNoteAtViewportCenter = useCallback(async () => {
    const t = getTransform();
    const spread = 40;
    const canvasX = -t.offsetX / t.scale + (Math.random() - 0.5) * spread;
    const canvasY = -t.offsetY / t.scale + (Math.random() - 0.5) * spread;
    await createNoteAt(canvasX, canvasY);
  }, [getTransform, createNoteAt]);

  // Double-click to create
  const handleDoubleClick = useCallback(
    async (e: React.MouseEvent) => {
      if (canvasLocked) return;
      if ((e.target as HTMLElement).closest("[data-notecard]")) return;
      const t = getTransform();
      const canvasX = (e.clientX - windowSize.w / 2 - t.offsetX) / t.scale;
      const canvasY = (e.clientY - windowSize.h / 2 - t.offsetY) / t.scale;
      await createNoteAt(canvasX, canvasY);
    },
    [canvasLocked, getTransform, windowSize, createNoteAt]
  );

  const {
    imageInputRef, videoInputRef, isDragOver,
    handleDragOver, handleDragLeave, handleDrop,
    handleImageInput, handleVideoInput,
  } = useCanvasMediaImport({ canvasLocked, windowSize, getTransform, createNote: createNoteAt });

  const handleCardTap = useCallback(
    (noteId: string) => { clearSelection(); openNote(noteId); },
    [openNote, clearSelection]
  );

  const handleCardShiftTap = useCallback(
    (noteId: string) => { selectNote(noteId); },
    [selectNote]
  );

  const handleDragStart = useCallback(
    (noteId: string) => {
      const leadNote = notes.find(n => n.id === noteId);
      if (!leadNote) return;
      leadStartRef.current = { x: leadNote.positionX, y: leadNote.positionY };

      const starts = new Map<string, { x: number; y: number }>();
      if (selectedIds.has(noteId) && selectedIds.size > 1) {
        // Group drag — store ALL selected cards (leader included)
        for (const note of notes) {
          if (selectedIds.has(note.id)) {
            starts.set(note.id, { x: note.positionX, y: note.positionY });
          }
        }
      } else {
        // Solo drag — still use the delta mechanism so the DB isn't touched
        // until drag end. Writing to Dexie per-frame would re-read every note
        // (including large video Blobs) and stall the main thread.
        starts.set(noteId, { x: leadNote.positionX, y: leadNote.positionY });
      }
      groupDragStartRef.current = starts;
      groupDragDeltaRef.current = { dx: 0, dy: 0 };
      setGroupDragDelta({ dx: 0, dy: 0 });
    },
    [selectedIds, notes]
  );

  const handleDragMove = useCallback(
    (_noteId: string, newX: number, newY: number) => {
      if (!leadStartRef.current) return;
      // Visual-only delta — DB is written once on drag end.
      const dx = newX - leadStartRef.current.x;
      const dy = newY - leadStartRef.current.y;
      groupDragDeltaRef.current = { dx, dy };
      if (!groupDragRafRef.current) {
        groupDragRafRef.current = requestAnimationFrame(() => {
          groupDragRafRef.current = 0;
          setGroupDragDelta({ ...groupDragDeltaRef.current });
        });
      }
    },
    []
  );

  const handleDragEnd = useCallback(
    async (noteId: string) => {
      const starts = groupDragStartRef.current;
      const dupeIds = dragDuplicateIdsRef.current;
      // Stop rotation immediately
      setGroupDragRotation(0);
      if (starts.size > 0) {
        const delta = groupDragDeltaRef.current;
        const moved = Math.abs(delta.dx) > 0.1 || Math.abs(delta.dy) > 0.1;
        // Record undo: batch if duplication happened, otherwise just move
        if (dupeIds.length > 0 && moved) {
          undoStack.record({
            type: "batch",
            actions: [
              { type: "create", noteIds: dupeIds },
              { type: "move", moves: [...starts].map(([id, start]) => ({ noteId: id, oldX: start.x, oldY: start.y })) },
            ],
          });
        } else if (dupeIds.length > 0) {
          undoStack.record({ type: "create", noteIds: dupeIds });
        } else if (moved) {
          undoStack.record({
            type: "move",
            moves: [...starts].map(([id, start]) => ({ noteId: id, oldX: start.x, oldY: start.y })),
          });
        }
        // Commit final positions to DB (once, on drag end)
        const promises: Promise<void>[] = [];
        for (const [id, start] of starts) {
          promises.push(updateNote(id, { positionX: start.x + delta.dx, positionY: start.y + delta.dy }));
        }
        await Promise.all(promises);
        await new Promise(r => setTimeout(r, 50));
      }
      // Clear refs
      groupDragStartRef.current = new Map();
      leadStartRef.current = null;
      groupDragDeltaRef.current = { dx: 0, dy: 0 };
      dragDuplicateIdsRef.current = [];
      setGroupDragDelta({ dx: 0, dy: 0 });
    },
    [updateNote]
  );

  const handleDragDuplicate = useCallback(
    async (noteId: string) => {
      const maxZ = Math.max(...notes.map(n => n.zOrder), 0);
      const createdIds: string[] = [];
      if (selectedIds.has(noteId) && selectedIds.size > 1) {
        const selected = notes.filter(n => selectedIds.has(n.id));
        let z = maxZ + 1;
        const dupeOps: { note: Note; z: number }[] = [];
        const origOps: { id: string; z: number }[] = [];
        for (const note of selected) {
          dupeOps.push({ note, z: z++ });
        }
        for (const note of selected) {
          origOps.push({ id: note.id, z: z++ });
        }
        await db.transaction("rw", db.notes, async () => {
          for (const op of dupeOps) {
            const copy = await duplicateNote(op.note, op.z);
            createdIds.push(copy.id);
          }
          for (const op of origOps) {
            await updateNote(op.id, { zOrder: op.z });
          }
        });
      } else {
        const note = notes.find(n => n.id === noteId);
        if (note) {
          await db.transaction("rw", db.notes, async () => {
            const copy = await duplicateNote(note, maxZ + 1);
            createdIds.push(copy.id);
            await updateNote(noteId, { zOrder: maxZ + 2 });
          });
        }
      }
      dragDuplicateIdsRef.current = createdIds;
    },
    [notes, selectedIds, duplicateNote, updateNote]
  );

  const handleDragRotation = useCallback((rotation: number) => {
    // Only propagate rotation to followers in an actual group drag.
    // Solo drag has no followers — the leader uses its own internal dragRotation.
    if (groupDragStartRef.current.size > 1) {
      setGroupDragRotation(rotation);
    }
  }, []);

  const handleResize = useCallback(
    (noteId: string, newScale: number, newPosX: number, newPosY: number) => {
      resizeOverrideRef.current = { noteId, cardScale: newScale, positionX: newPosX, positionY: newPosY };
      if (!resizeRafRef.current) {
        resizeRafRef.current = requestAnimationFrame(() => {
          resizeRafRef.current = 0;
          setResizeOverride(resizeOverrideRef.current);
        });
      }
    },
    []
  );

  const handleResizeEnd = useCallback(
    async (noteId: string, oldScale: number, oldPosX: number, oldPosY: number) => {
      undoStack.record({ type: "resize", noteId, oldScale, oldPosX, oldPosY });
      const override = resizeOverrideRef.current;
      if (resizeRafRef.current) {
        cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = 0;
      }
      if (override && override.noteId === noteId) {
        await updateNote(noteId, { cardScale: override.cardScale, positionX: override.positionX, positionY: override.positionY });
        // Wait two frames so Dexie's liveQuery has propagated and React has
        // re-rendered with the new note values before we drop the visual
        // override — otherwise the card snaps to its pre-resize size.
        await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      }
      resizeOverrideRef.current = null;
      setResizeOverride(null);
    },
    [updateNote]
  );

  // Context menu: right-click on card
  const handleCardContextMenu = useCallback(
    (e: React.MouseEvent, noteId: string) => {
      e.preventDefault();
      e.stopPropagation();
      // If the card isn't already selected, select it exclusively
      if (!selectedIds.has(noteId)) {
        setSelectedIds(new Set([noteId]));
      }
      setContextMenu({ x: e.clientX, y: e.clientY, noteId });
    },
    [selectedIds, setSelectedIds]
  );

  const handleCanvasContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (selectedIds.size > 0) {
        setContextMenu({ x: e.clientX, y: e.clientY, noteId: null });
      }
    },
    [selectedIds]
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  // Delete selected cards (reused by context menu and keyboard shortcut)
  const deleteSelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    const toDelete = new Set(selectedIds);
    const snapshots = notes
      .filter(n => toDelete.has(n.id))
      .map(snapshotFromNote);
    undoStack.record({ type: "delete", snapshots });
    setDeletingIds(toDelete);
    setSelectedIds(new Set());
    setTimeout(() => {
      for (const id of toDelete) deleteNote(id);
      setDeletingIds(new Set());
    }, DELETE_DURATION * 1000);
  }, [notes, selectedIds, setSelectedIds, setDeletingIds, deleteNote]);

  // Build context menu items
  const contextMenuItems: MenuItem[] = contextMenu
    ? [
        {
          icon: LayoutGrid,
          label: "Reorder",
          shortcut: `${MOD}G`,
          action: reorderSelected,
          hidden: selectedIds.size < 2,
        },
        {
          icon: Copy,
          label: "Copy",
          shortcut: `${MOD}C`,
          action: copySelected,
        },
        {
          icon: Copy,
          label: "Duplicate",
          shortcut: `${MOD}D`,
          action: duplicateSelected,
        },
        {
          icon: Trash2,
          label: "Delete",
          shortcut: "⌫",
          action: deleteSelected,
        },
      ]
    : [];

  const handleCanvasPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button === 2) return;
      spacePanDown(e);
      if (!spaceHeld) {
        handleMarqueeDown(e);
      }
    },
    [spacePanDown, spaceHeld, handleMarqueeDown]
  );

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative overflow-hidden bg-canvas"
      style={{
        cursor: spaceHeld ? "grab" : marquee ? "crosshair" : "default",
      }}
      onDoubleClick={handleDoubleClick}
      onPointerDown={handleCanvasPointerDown}
      onPointerMove={spacePanMove}
      onPointerUp={spacePanUp}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onContextMenu={handleCanvasContextMenu}
    >
      {/* Drag-over indicator */}
      {isDragOver && (
        <div
          className="absolute inset-0 pointer-events-none rounded-xl z-(--z-drag-over) bg-accent/5 border-[3px] border-dashed border-accent/40"
        />
      )}

      {/* White overlay */}
      {openProgress > 0 && (
        <div
          className="absolute inset-0 pointer-events-none bg-card-open z-(--z-card-overlay)"
          style={{ opacity: openProgress }}
        />
      )}

      {/* Canvas layer */}
      <div
        ref={layerRef}
        className="absolute origin-top-left"
        style={{
          left: windowSize.w / 2,
          top: windowSize.h / 2,
        }}
      >
        {notes.map((note) => {
          const isOpening = note.id === openNoteId && openProgress > 0;
          // For video cards we keep the canvas-list instance mounted during
          // open as a "shadow" — it owns the persistent <video> portal so the
          // element never remounts on tap/close. Non-video cards drop out.
          // NOTE: video-opening starts the instant openNoteId is set (openProgress
          // may still be 0 for one render); otherwise the PVP would unmount in
          // that gap and remount as a new <video> element.
          const isVideoOpening = note.id === openNoteId && getHeaderMedia(note)?.type === "video";
          if (isOpening && !isVideoOpening) return null;
          // Card is in the group drag if it's in groupDragStartRef (leader + followers)
          const inGroupDrag = groupDragStartRef.current.has(note.id);
          // Pin to start position during group drag to avoid double-delta when Dexie propagates
          const startPos = inGroupDrag ? groupDragStartRef.current.get(note.id)! : null;
          const resizeOver = resizeOverride?.noteId === note.id ? resizeOverride : null;
          const noteForCard = resizeOver
            ? { ...note, cardScale: resizeOver.cardScale, positionX: resizeOver.positionX, positionY: resizeOver.positionY }
            : startPos
              ? { ...note, positionX: startPos.x, positionY: startPos.y }
              : note;

          // Viewport culling — skip cards outside visible area
          const { w: cw, h: ch } = getCardSize(noteForCard);
          const s = transformRef.current.scale;
          const ox = transformRef.current.offsetX;
          const oy = transformRef.current.offsetY;
          const screenX = windowSize.w / 2 + noteForCard.positionX * s + ox;
          const screenY = windowSize.h / 2 + noteForCard.positionY * s + oy;
          const margin = 400;
          const isVisible =
            screenX + (cw / 2) * s > -margin &&
            screenX - (cw / 2) * s < windowSize.w + margin &&
            screenY + (ch / 2) * s > -margin &&
            screenY - (ch / 2) * s < windowSize.h + margin;
          if (!isVisible && !selectedIds.has(note.id) && !deletingIds.has(note.id) && !inGroupDrag && !popIds.has(note.id) && !isVideoOpening) return null;

          return (
            <div
              key={note.id}
              data-notecard
              onContextMenu={(e) => handleCardContextMenu(e, note.id)}
            >
              <NoteCard
                note={noteForCard}
                scale={transformRef.current.scale}
                offsetX={ox}
                offsetY={oy}
                windowW={windowSize.w}
                windowH={windowSize.h}
                isOpen={false}
                isSelected={selectedIds.has(note.id)}
                isDeleting={deletingIds.has(note.id)}
                isPopping={popIds.has(note.id)}
                isAnimating={animatingIds.has(note.id)}
                openProgress={isVideoOpening ? openProgress : 0}
                isClosing={isVideoOpening ? isClosing : false}
                closingScrollOffset={isVideoOpening ? closingScrollOffset : 0}
                isShadowInstance={isVideoOpening}
                hoverSuppressed={marquee !== null || openNoteId !== null}
                spaceHeld={spaceHeld}
                groupDragDelta={inGroupDrag ? groupDragDelta : ZERO_DELTA}
                groupDragRotation={inGroupDrag ? groupDragRotation : 0}
                onTap={handleCardTap}
                onShiftTap={handleCardShiftTap}
                onClose={closeNote}
                onDragStart={handleDragStart}
                onDragMove={handleDragMove}
                onDragEnd={handleDragEnd}
                onDragRotation={handleDragRotation}
                onDragDuplicate={handleDragDuplicate}
                onBringToFront={bringToFront}
                onResize={handleResize}
                onResizeEnd={handleResizeEnd}
              >
                <NotePreview blocks={note.blocks} />
              </NoteCard>
            </div>
          );
        })}
      </div>

      {/* Persistent video portal root — OUTSIDE the canvas layer so it is not
          inside the layer's scale() transform. The scale() creates a new
          compositor stacking context; when PVPs switch from this root to
          document.body on open, Chrome re-composites the video texture (different
          color path) causing the visible saccade. By keeping this root outside
          the scaled layer both portal targets share the same compositor context.
          Transform is mirrored from the canvas layer via applyTransform (direct
          DOM, no React re-renders) so pan/zoom still has zero lag. */}
      <div
        id="pvp-portal-root"
        style={{
          position: "fixed",
          left: windowSize.w / 2,
          top: windowSize.h / 2,
          transformOrigin: "top left",
          pointerEvents: "none",
          zIndex: 9997,
        }}
      />

      {/* Opening/open card */}
      {openNoteId && openProgress > 0 && notes.filter(n => n.id === openNoteId).map((note) => (
        <div key={note.id} data-notecard>
          <NoteCard
            note={note}
            scale={openTransform.scale}
            offsetX={openTransform.offsetX}
            offsetY={openTransform.offsetY}
            windowW={windowSize.w}
            windowH={windowSize.h}
            isOpen={openProgress > 0.5}
            isSelected={false}
            isDeleting={false}
            openProgress={openProgress}
            isClosing={isClosing}
            closingScrollOffset={closingScrollOffset}
            hoverSuppressed={false}
                spaceHeld={false}
            groupDragDelta={{ dx: 0, dy: 0 }}
            groupDragRotation={0}
            onTap={NOOP_ID}
            onShiftTap={NOOP_ID}
            onClose={closeNote}
            onDragStart={NOOP_ID}
            onDragMove={handleDragMove}
            onDragEnd={handleDragEnd}
            onBringToFront={bringToFront}
            suppressVideoPortal
          >
            <div style={{ "--open-progress": openProgress } as React.CSSProperties}>
              <OpenCardContent note={note} openProgress={openProgress} updateNote={updateNote} />
            </div>
          </NoteCard>
        </div>
      ))}

      {/* Marquee selection rectangle */}
      {marquee && (
        <div
          className="absolute pointer-events-none rounded-sm z-(--z-marquee) bg-accent/10 border border-accent/30"
          style={{
            left: marquee.x,
            top: marquee.y,
            width: marquee.w,
            height: marquee.h,
          }}
        />
      )}

      {/* Add note / image / video buttons */}
      {!canvasLocked && (
        <div className="fixed bottom-6 right-6 flex gap-2 z-(--z-fab)">
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImageInput}
          />
          <input
            ref={videoInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={handleVideoInput}
          />
          <button
            className="w-12 h-12 rounded-full flex items-center justify-center cursor-pointer border-none select-none bg-card text-text-muted shadow-fab"
            title="Add video"
            onDoubleClick={(e) => e.stopPropagation()}
            onClick={() => videoInputRef.current?.click()}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m22 8-6 4 6 4V8Z" />
              <rect width="14" height="12" x="2" y="6" rx="2" ry="2" />
            </svg>
          </button>
          <button
            className="w-12 h-12 rounded-full flex items-center justify-center cursor-pointer border-none select-none bg-card text-text-muted shadow-fab"
            title="Add image"
            onDoubleClick={(e) => e.stopPropagation()}
            onClick={() => imageInputRef.current?.click()}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </button>
          <button
            className="w-12 h-12 rounded-full flex items-center justify-center text-2xl cursor-pointer border-none select-none bg-card text-text-muted shadow-fab"
            onDoubleClick={(e) => e.stopPropagation()}
            onClick={createNoteAtViewportCenter}
          >
            +
          </button>
        </div>
      )}

      {/* Empty state */}
      {notes.length === 0 && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-lg select-none text-text-muted">
          Double-click to create a note
        </div>
      )}

      {/* Context menu */}
      {contextMenu && !canvasLocked && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
}
