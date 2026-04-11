import { useCallback, useEffect, useRef, useState } from "react";
import { useNotes } from "../store/useNotes";
import { useCanvas } from "../store/useCanvas";
import { useOpenClose } from "../hooks/useOpenClose";
import { useSpacePan } from "../hooks/useSpacePan";
import { useWheelNavigation } from "../hooks/useWheelNavigation";
import NoteCard from "../components/NoteCard";
import NoteEditor from "../components/NoteEditor";

export default function Canvas() {
  const { notes, addNote, updateNote, bringToFront } = useNotes();
  const { transformRef, layerRef, pan, zoom, getTransform, applyTransform } = useCanvas();
  const containerRef = useRef<HTMLDivElement>(null);
  const [windowSize, setWindowSize] = useState({ w: window.innerWidth, h: window.innerHeight });

  const { openNoteId, openProgress, closingScrollOffset, openTransform, openNote, closeNote } =
    useOpenClose(bringToFront, getTransform);

  const canvasLocked = openNoteId !== null;
  const { spaceHeld, handlePointerDown: spacePanDown, handlePointerMove: spacePanMove, handlePointerUp: spacePanUp } =
    useSpacePan(canvasLocked, pan, getTransform);

  useWheelNavigation(containerRef, canvasLocked, windowSize.w, windowSize.h, pan, zoom);

  useEffect(() => {
    const onResize = () => setWindowSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => { applyTransform(); }, [applyTransform]);

  // Escape to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && openNoteId) closeNote();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openNoteId, closeNote]);

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

  const handleDragMove = useCallback(
    (noteId: string, newX: number, newY: number) => {
      updateNote(noteId, { positionX: newX, positionY: newY });
    },
    [updateNote]
  );

  const handleDragEnd = useCallback((_noteId: string) => {}, []);

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative overflow-hidden"
      style={{ background: "var(--color-canvas)", cursor: spaceHeld ? "grab" : "default" }}
      onDoubleClick={handleDoubleClick}
      onPointerDown={spacePanDown}
      onPointerMove={spacePanMove}
      onPointerUp={spacePanUp}
    >
      {/* White overlay — covers all cards during open/close */}
      {openProgress > 0 && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "#ffffff", opacity: openProgress, zIndex: 9998 }}
        />
      )}

      {/* Canvas layer — DOM-driven transform, no React re-renders on pan/zoom */}
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
          const isThisOpen = note.id === openNoteId;
          if (isThisOpen && openProgress > 0) return null;
          return (
            <div key={note.id} data-notecard>
              <NoteCard
                note={note}
                scale={transformRef.current.scale}
                offsetX={transformRef.current.offsetX}
                offsetY={transformRef.current.offsetY}
                windowW={windowSize.w}
                windowH={windowSize.h}
                isOpen={false}
                openProgress={0}
                closingScrollOffset={0}
                onTap={() => openNote(note.id)}
                onClose={closeNote}
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
                  editable={false}
                  headerImageUrl={note.kind === "image" ? note.imageDataUrl : undefined}
                />
              </NoteCard>
            </div>
          );
        })}
      </div>

      {/* Opening/open card — rendered outside canvas layer (screen-space) */}
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
            openProgress={openProgress}
            closingScrollOffset={closingScrollOffset}
            onTap={() => {}}
            onClose={closeNote}
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

      {/* Empty state */}
      {notes.length === 0 && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-lg select-none" style={{ color: "var(--color-text-muted)" }}>
          Double-click to create a note
        </div>
      )}
    </div>
  );
}
