import { useCallback, useEffect, useRef, useState } from "react";
import { useNotes } from "../store/useNotes";
import { useCanvas } from "../store/useCanvas";
import NoteCard from "../components/NoteCard";
import NoteEditor from "../components/NoteEditor";

// ── Animated value with ease-out cubic ──
function useAnimatedValue(target: number, duration = 500) {
  const [value, setValue] = useState(target);
  const rafRef = useRef(0);
  const startRef = useRef({ time: 0, from: target, to: target });

  useEffect(() => {
    const start = performance.now();
    startRef.current = { time: start, from: value, to: target };

    function tick(now: number) {
      const elapsed = now - startRef.current.time;
      const t = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(startRef.current.from + (startRef.current.to - startRef.current.from) * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration]);

  return value;
}

export default function Canvas() {
  const { notes, addNote, updateNote, bringToFront } = useNotes();
  const { transform, pan, zoom } = useCanvas();
  const containerRef = useRef<HTMLDivElement>(null);
  const [windowSize, setWindowSize] = useState({ w: window.innerWidth, h: window.innerHeight });

  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [openTarget, setOpenTarget] = useState(0);
  const openProgress = useAnimatedValue(openTarget, 450);

  const canvasLocked = openNoteId !== null;

  useEffect(() => {
    const onResize = () => setWindowSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // ── Wheel: pan + pinch-zoom ──
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      if (canvasLocked) return;
      if (e.ctrlKey || e.metaKey) {
        zoom(e.deltaY, e.clientX, e.clientY);
      } else {
        pan(-e.deltaX, -e.deltaY);
      }
    },
    [pan, zoom, canvasLocked]
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  // ── Double-click to create ──
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (canvasLocked) return;
      if ((e.target as HTMLElement).closest("[data-notecard]")) return;
      const canvasX = (e.clientX - windowSize.w / 2 - transform.offsetX) / transform.scale;
      const canvasY = (e.clientY - windowSize.h / 2 - transform.offsetY) / transform.scale;
      addNote(canvasX, canvasY);
    },
    [addNote, canvasLocked, transform, windowSize]
  );

  // ── Open / close ──
  const openNote = useCallback(
    (id: string) => {
      bringToFront(id);
      setOpenNoteId(id);
      setOpenTarget(1);
    },
    [bringToFront]
  );

  const closeNote = useCallback(() => {
    setOpenTarget(0);
    setTimeout(() => setOpenNoteId(null), 500);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && openNoteId) closeNote();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openNoteId, closeNote]);

  // ── Drag ──
  const handleDragMove = useCallback(
    (noteId: string, newX: number, newY: number) => {
      updateNote(noteId, { positionX: newX, positionY: newY });
    },
    [updateNote]
  );

  const handleDragEnd = useCallback((_noteId: string) => {}, []);

  const showBackdrop = openNoteId !== null && openProgress > 0;

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative overflow-hidden"
      onDoubleClick={handleDoubleClick}
    >
      {/* Backdrop */}
      {showBackdrop && (
        <div
          className="fixed inset-0 z-[9998]"
          style={{ background: "var(--color-canvas)", opacity: openProgress * 0.8 }}
          onClick={closeNote}
        />
      )}

      {/* Notes */}
      {notes.map((note) => {
        const isThisOpen = note.id === openNoteId;
        const thisProgress = isThisOpen ? openProgress : 0;

        return (
          <div key={note.id} data-notecard>
            <NoteCard
              note={note}
              scale={transform.scale}
              offsetX={transform.offsetX}
              offsetY={transform.offsetY}
              windowW={windowSize.w}
              windowH={windowSize.h}
              isOpen={isThisOpen && openTarget === 1}
              openProgress={thisProgress}
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
                editable={isThisOpen && openProgress > 0.9}
                headerImageUrl={note.kind === "image" ? note.imageDataUrl : undefined}
              />
            </NoteCard>
          </div>
        );
      })}

      {/* Empty state */}
      {notes.length === 0 && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-lg select-none" style={{ color: "var(--color-text-muted)" }}>
          Double-click to create a note
        </div>
      )}
    </div>
  );
}
