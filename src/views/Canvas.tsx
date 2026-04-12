import { useCallback, useEffect, useRef, useState } from "react";
import { useNotes } from "../store/useNotes";
import { db, type Note } from "../store/db";
import { useCanvas } from "../store/useCanvas";
import { useOpenClose } from "../hooks/useOpenClose";
import { useSpacePan } from "../hooks/useSpacePan";
import { useWheelNavigation } from "../hooks/useWheelNavigation";
import { useSelection } from "../hooks/useSelection";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { CanvasUndoStack, snapshotFromNote, noteFromSnapshot, type CanvasAction } from "../store/undoStack";
import { DELETE_DURATION } from "../constants";
import { getCardSize } from "../lib/cardDimensions";
import NoteCard from "../components/NoteCard";
import NoteEditor from "../components/NoteEditor";
import NotePreview from "../components/NotePreview";

const undoStack = new CanvasUndoStack();
const ZERO_DELTA = { dx: 0, dy: 0 };
const NOOP = () => {};
const NOOP_ID = (_id: string) => {};

export default function Canvas() {
  const { notes, addNote, updateNote, deleteNote, duplicateNote, bringToFront } = useNotes();
  const { transformRef, transformVersion, layerRef, pan, zoom, getTransform, applyTransform } = useCanvas();
  void transformVersion;
  const containerRef = useRef<HTMLDivElement>(null);
  const [windowSize, setWindowSize] = useState({ w: window.innerWidth, h: window.innerHeight });

  const { openNoteId, openProgress, closingScrollOffset, openTransform, openNote, closeNote } =
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
  const popTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const triggerPop = useCallback((ids: string[]) => {
    setPopIds(prev => { const next = new Set(prev); for (const id of ids) next.add(id); return next; });
    clearTimeout(popTimerRef.current);
    popTimerRef.current = setTimeout(() => setPopIds(new Set()), 400);
  }, []);
  const [animatingIds, setAnimatingIds] = useState<Set<string>>(new Set());

  // Group drag state
  const [groupDragDelta, setGroupDragDelta] = useState({ dx: 0, dy: 0 });
  const [groupDragRotation, setGroupDragRotation] = useState(0);
  const groupDragDeltaRef = useRef({ dx: 0, dy: 0 });
  const groupDragRafRef = useRef(0);
  // Stores start positions for ALL cards in the group (leader + followers)
  const groupDragStartRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const leadStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragDuplicateIdsRef = useRef<string[]>([]);

  useEffect(() => {
    const onResize = () => setWindowSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => { applyTransform(); }, [applyTransform]);

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

  useKeyboardShortcuts({
    notes, canvasLocked, selectedIds, setSelectedIds, setDeletingIds,
    closeNote, clearSelection, selectAll, deleteNote, openNote,
    onUndo: performUndo, onRedo: performRedo,
    recordAction: undoStack.record.bind(undoStack),
  });

  // Double-click to create
  const handleDoubleClick = useCallback(
    async (e: React.MouseEvent) => {
      if (canvasLocked) return;
      if ((e.target as HTMLElement).closest("[data-notecard]")) return;
      const t = getTransform();
      const canvasX = (e.clientX - windowSize.w / 2 - t.offsetX) / t.scale;
      const canvasY = (e.clientY - windowSize.h / 2 - t.offsetY) / t.scale;
      const note = await addNote(canvasX, canvasY);
      undoStack.record({ type: "create", noteIds: [note.id] });
      triggerPop([note.id]);
    },
    [addNote, canvasLocked, getTransform, windowSize, triggerPop]
  );

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

      if (selectedIds.has(noteId) && selectedIds.size > 1) {
        // Group drag — store ALL selected cards (leader included)
        const starts = new Map<string, { x: number; y: number }>();
        for (const note of notes) {
          if (selectedIds.has(note.id)) {
            starts.set(note.id, { x: note.positionX, y: note.positionY });
          }
        }
        groupDragStartRef.current = starts;
      } else {
        groupDragStartRef.current = new Map();
      }
      groupDragDeltaRef.current = { dx: 0, dy: 0 };
      setGroupDragDelta({ dx: 0, dy: 0 });
    },
    [selectedIds, notes]
  );

  const handleDragMove = useCallback(
    (noteId: string, newX: number, newY: number) => {
      if (groupDragStartRef.current.size > 0 && leadStartRef.current) {
        // Group drag — no DB updates, all movement is visual via delta
        const dx = newX - leadStartRef.current.x;
        const dy = newY - leadStartRef.current.y;
        groupDragDeltaRef.current = { dx, dy };
        if (!groupDragRafRef.current) {
          groupDragRafRef.current = requestAnimationFrame(() => {
            groupDragRafRef.current = 0;
            setGroupDragDelta({ ...groupDragDeltaRef.current });
          });
        }
      } else {
        // Solo drag — update DB directly
        updateNote(noteId, { positionX: newX, positionY: newY });
      }
    },
    [updateNote]
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
        // Commit final positions to DB
        const promises: Promise<void>[] = [];
        for (const [id, start] of starts) {
          promises.push(updateNote(id, { positionX: start.x + delta.dx, positionY: start.y + delta.dy }));
        }
        await Promise.all(promises);
        await new Promise(r => setTimeout(r, 50));
      } else if (leadStartRef.current) {
        // Solo drag
        const lead = leadStartRef.current;
        const note = notesRef.current.find(n => n.id === noteId);
        const moved = note && (Math.abs(note.positionX - lead.x) > 0.1 || Math.abs(note.positionY - lead.y) > 0.1);
        if (dupeIds.length > 0 && moved) {
          undoStack.record({
            type: "batch",
            actions: [
              { type: "create", noteIds: dupeIds },
              { type: "move", moves: [{ noteId, oldX: lead.x, oldY: lead.y }] },
            ],
          });
        } else if (dupeIds.length > 0) {
          undoStack.record({ type: "create", noteIds: dupeIds });
        } else if (moved) {
          undoStack.record({
            type: "move",
            moves: [{ noteId, oldX: lead.x, oldY: lead.y }],
          });
        }
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
    if (groupDragStartRef.current.size > 0) {
      setGroupDragRotation(rotation);
    }
  }, []);

  const handleCanvasPointerDown = useCallback(
    (e: React.PointerEvent) => {
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
      className="w-full h-full relative overflow-hidden"
      style={{
        background: "var(--color-canvas)",
        cursor: spaceHeld ? "grab" : marquee ? "crosshair" : "default",
      }}
      onDoubleClick={handleDoubleClick}
      onPointerDown={handleCanvasPointerDown}
      onPointerMove={spacePanMove}
      onPointerUp={spacePanUp}
    >
      {/* White overlay */}
      {openProgress > 0 && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "var(--color-card-open)", opacity: openProgress, zIndex: 9998 }}
        />
      )}

      {/* Canvas layer */}
      <div
        ref={layerRef}
        style={{
          position: "absolute",
          left: windowSize.w / 2,
          top: windowSize.h / 2,
          transformOrigin: "0 0",
        }}
      >
        {notes.map((note) => {
          if (note.id === openNoteId && openProgress > 0) return null;
          // Card is in the group drag if it's in groupDragStartRef (leader + followers)
          const inGroupDrag = groupDragStartRef.current.has(note.id);
          // Pin to start position during group drag to avoid double-delta when Dexie propagates
          const startPos = inGroupDrag ? groupDragStartRef.current.get(note.id)! : null;
          const noteForCard = startPos
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
          if (!isVisible && !selectedIds.has(note.id) && !deletingIds.has(note.id) && !inGroupDrag && !popIds.has(note.id)) return null;

          return (
            <div
              key={note.id}
              data-notecard
            >
              <NoteCard
                note={noteForCard}
                scale={transformRef.current.scale}
                offsetX={0}
                offsetY={0}
                windowW={0}
                windowH={0}
                isOpen={false}
                isSelected={selectedIds.has(note.id)}
                isDeleting={deletingIds.has(note.id)}
                isPopping={popIds.has(note.id)}
                isAnimating={animatingIds.has(note.id)}
                openProgress={0}
                closingScrollOffset={0}
                hoverSuppressed={marquee !== null}
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
              >
                <NotePreview
                  blocks={note.blocks}
                  headerImageUrl={note.kind === "image" ? note.imageDataUrl : undefined}
                />
              </NoteCard>
            </div>
          );
        })}
      </div>

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
            closingScrollOffset={closingScrollOffset}
            hoverSuppressed={false}
            groupDragDelta={{ dx: 0, dy: 0 }}
            groupDragRotation={0}
            onTap={NOOP_ID}
            onShiftTap={NOOP_ID}
            onClose={closeNote}
            onDragStart={NOOP_ID}
            onDragMove={handleDragMove}
            onDragEnd={handleDragEnd}
            onBringToFront={bringToFront}
          >
            <NoteEditor
              blocks={note.blocks}
              onUpdate={(blocks) => {
                const title = blocks[0]?.content ?? "";
                updateNote(note.id, { blocks, title });
              }}
              editable={openProgress >= 1}
              headerImageUrl={note.kind === "image" ? note.imageDataUrl : undefined}
            />
          </NoteCard>
        </div>
      ))}

      {/* Marquee selection rectangle */}
      {marquee && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: marquee.x,
            top: marquee.y,
            width: marquee.w,
            height: marquee.h,
            background: "rgba(74, 158, 255, 0.08)",
            border: "1px solid rgba(74, 158, 255, 0.3)",
            borderRadius: 4,
            zIndex: 9990,
          }}
        />
      )}

      {/* Add note button */}
      {!canvasLocked && (
        <button
          className="fixed bottom-6 right-6 w-12 h-12 rounded-full flex items-center justify-center text-2xl cursor-pointer border-none select-none"
          style={{
            background: "var(--color-card)",
            color: "var(--color-text-muted)",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            zIndex: 100,
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          onClick={async () => {
            const t = getTransform();
            const spread = 40;
            const canvasX = -t.offsetX / t.scale + (Math.random() - 0.5) * spread;
            const canvasY = -t.offsetY / t.scale + (Math.random() - 0.5) * spread;
            const note = await addNote(canvasX, canvasY);
            undoStack.record({ type: "create", noteIds: [note.id] });
            triggerPop([note.id]);
          }}
        >
          +
        </button>
      )}

      {/* Empty state */}
      {notes.length === 0 && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-lg select-none" style={{ color: "var(--color-text-muted)" }}>
          Double-click to create a note
        </div>
      )}
    </div>
  );
}
