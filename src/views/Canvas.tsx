import { useCallback, useEffect, useRef, useState } from "react";
import { useNotes } from "../store/useNotes";
import { db, type Note } from "../store/db";
import { useCanvas } from "../store/useCanvas";
import { useOpenClose } from "../hooks/useOpenClose";
import { useSpacePan } from "../hooks/useSpacePan";
import { useWheelNavigation } from "../hooks/useWheelNavigation";
import { useSelection } from "../hooks/useSelection";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import NoteCard from "../components/NoteCard";
import NoteEditor from "../components/NoteEditor";

export default function Canvas() {
  const { notes, addNote, updateNote, deleteNote, duplicateNote, bringToFront } = useNotes();
  const { transformRef, layerRef, pan, zoom, getTransform, applyTransform } = useCanvas();
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

  // Group drag state
  const [groupDragDelta, setGroupDragDelta] = useState({ dx: 0, dy: 0 });
  const [groupDragRotation, setGroupDragRotation] = useState(0);
  const groupDragDeltaRef = useRef({ dx: 0, dy: 0 });
  // Stores start positions for ALL cards in the group (leader + followers)
  const groupDragStartRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const leadStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const onResize = () => setWindowSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => { applyTransform(); }, [applyTransform]);

  useKeyboardShortcuts({
    notes, canvasLocked, selectedIds, setSelectedIds, setDeletingIds,
    closeNote, clearSelection, selectAll, deleteNote, openNote,
  });

  // Double-click to create
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (canvasLocked) return;
      if ((e.target as HTMLElement).closest("[data-notecard]")) return;
      const t = getTransform();
      const canvasX = (e.clientX - windowSize.w / 2 - t.offsetX) / t.scale;
      const canvasY = (e.clientY - windowSize.h / 2 - t.offsetY) / t.scale;
      addNote(canvasX, canvasY);
    },
    [addNote, canvasLocked, getTransform, windowSize]
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
        setGroupDragDelta({ dx, dy });
      } else {
        // Solo drag — update DB directly
        updateNote(noteId, { positionX: newX, positionY: newY });
      }
    },
    [updateNote]
  );

  const handleDragEnd = useCallback(
    async (_noteId: string) => {
      const starts = groupDragStartRef.current;
      // Stop rotation immediately
      setGroupDragRotation(0);
      if (starts.size > 0) {
        // Commit final positions to DB
        const delta = groupDragDeltaRef.current;
        const promises: Promise<void>[] = [];
        for (const [id, start] of starts) {
          promises.push(updateNote(id, { positionX: start.x + delta.dx, positionY: start.y + delta.dy }));
        }
        // Wait for DB writes to complete
        await Promise.all(promises);
        // Wait for Dexie → useLiveQuery → React to propagate new positions
        // The ref stays populated so cards remain pinned at startPos + delta
        await new Promise(r => setTimeout(r, 50));
      }
      // NOW safe: DB positions are propagated, clearing ref won't cause a snap
      groupDragStartRef.current = new Map();
      leadStartRef.current = null;
      groupDragDeltaRef.current = { dx: 0, dy: 0 };
      setGroupDragDelta({ dx: 0, dy: 0 });
    },
    [updateNote]
  );

  const handleDragDuplicate = useCallback(
    async (noteId: string) => {
      const maxZ = Math.max(...notes.map(n => n.zOrder), 0);
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
            await duplicateNote(op.note, op.z);
          }
          for (const op of origOps) {
            await updateNote(op.id, { zOrder: op.z });
          }
        });
      } else {
        const note = notes.find(n => n.id === noteId);
        if (note) {
          await db.transaction("rw", db.notes, async () => {
            await duplicateNote(note, maxZ + 1);
            await updateNote(noteId, { zOrder: maxZ + 2 });
          });
        }
      }
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
          willChange: "transform",
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
          return (
            <div
              key={note.id}
              data-notecard
            >
              <NoteCard
                note={noteForCard}
                scale={transformRef.current.scale}
                offsetX={transformRef.current.offsetX}
                offsetY={transformRef.current.offsetY}
                windowW={windowSize.w}
                windowH={windowSize.h}
                isOpen={false}
                isSelected={selectedIds.has(note.id)}
                isDeleting={deletingIds.has(note.id)}
                openProgress={0}
                closingScrollOffset={0}
                hoverSuppressed={marquee !== null}
                groupDragDelta={inGroupDrag ? groupDragDelta : { dx: 0, dy: 0 }}
                groupDragRotation={inGroupDrag ? groupDragRotation : 0}
                onTap={() => handleCardTap(note.id)}
                onShiftTap={() => handleCardShiftTap(note.id)}
                onClose={closeNote}
                onDragStart={handleDragStart}
                onDragMove={handleDragMove}
                onDragEnd={handleDragEnd}
                onDragRotation={handleDragRotation}
                onDragDuplicate={handleDragDuplicate}
                onBringToFront={bringToFront}
              >
                <NoteEditor
                  blocks={note.blocks}
                  onUpdate={(blocks) => {
                    const title = blocks[0]?.content ?? "";
                    updateNote(note.id, { blocks, title });
                  }}
                  editable={false}
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
            onTap={() => {}}
            onShiftTap={() => {}}
            onClose={closeNote}
            onDragStart={() => {}}
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

      {/* Empty state */}
      {notes.length === 0 && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-lg select-none" style={{ color: "var(--color-text-muted)" }}>
          Double-click to create a note
        </div>
      )}
    </div>
  );
}
