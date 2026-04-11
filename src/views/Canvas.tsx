import { useCallback, useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useNotes } from "../store/useNotes";
import { useCanvas } from "../store/useCanvas";
import NoteCard from "../components/NoteCard";
import NoteEditor from "../components/NoteEditor";

const OPEN_DURATION = 0.5;
const CLOSE_DURATION = 0.45;

export default function Canvas() {
  const { notes, addNote, updateNote, bringToFront } = useNotes();
  const { transformRef, layerRef, pan, zoom, getTransform, applyTransform } = useCanvas();
  const containerRef = useRef<HTMLDivElement>(null);
  const [windowSize, setWindowSize] = useState({ w: window.innerWidth, h: window.innerHeight });

  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [openProgress, setOpenProgress] = useState(0);
  const [closingScrollOffset, setClosingScrollOffset] = useState(0);
  // Snapshot of transform at the moment a card starts opening (for screen-space animation)
  const [openTransform, setOpenTransform] = useState({ offsetX: 0, offsetY: 0, scale: 0.5 });
  const progressRef = useRef({ value: 0 });
  const tweenRef = useRef<gsap.core.Tween | null>(null);

  const canvasLocked = openNoteId !== null;
  const [spaceHeld, setSpaceHeld] = useState(false);
  const spacePanRef = useRef<{ startX: number; startY: number; offsetX: number; offsetY: number } | null>(null);

  useEffect(() => {
    const onResize = () => setWindowSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Apply initial transform to DOM
  useEffect(() => { applyTransform(); }, [applyTransform]);

  // ── Space + drag to pan ──
  useEffect(() => {
    if (canvasLocked) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        setSpaceHeld(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceHeld(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [canvasLocked]);

  // ── Wheel: pan + pinch-zoom (no React re-render) ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el || canvasLocked) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        zoom(e.deltaY, e.clientX, e.clientY, windowSize.w, windowSize.h);
      } else {
        pan(-e.deltaX * 1.3, -e.deltaY * 1.3);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [pan, zoom, canvasLocked, windowSize.w, windowSize.h]);

  // ── Double-click to create ──
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

  // ── Open / close with GSAP ──
  const openNote = useCallback(
    (id: string) => {
      bringToFront(id);
      setOpenTransform({ ...getTransform() });
      setOpenNoteId(id);
      tweenRef.current?.kill();
      tweenRef.current = gsap.to(progressRef.current, {
        value: 1,
        duration: OPEN_DURATION,
        ease: "power3.out",
        onUpdate: () => setOpenProgress(progressRef.current.value),
      });
    },
    [bringToFront, getTransform]
  );

  const closeNote = useCallback(() => {
    const scrollEl = document.querySelector("[data-editor-overlay]") as HTMLElement | null;
    setClosingScrollOffset(scrollEl?.scrollTop ?? 0);
    tweenRef.current?.kill();
    tweenRef.current = gsap.to(progressRef.current, {
      value: 0,
      duration: CLOSE_DURATION,
      ease: "power3.out",
      onUpdate: () => setOpenProgress(progressRef.current.value),
      onComplete: () => { setOpenNoteId(null); setClosingScrollOffset(0); },
    });
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

  const handleSpacePanDown = useCallback(
    (e: React.PointerEvent) => {
      if (!spaceHeld || canvasLocked) return;
      e.preventDefault();
      const t = getTransform();
      spacePanRef.current = { startX: e.clientX, startY: e.clientY, offsetX: t.offsetX, offsetY: t.offsetY };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [spaceHeld, canvasLocked, getTransform]
  );

  const handleSpacePanMove = useCallback(
    (e: React.PointerEvent) => {
      if (!spacePanRef.current) return;
      const t = getTransform();
      const dx = e.clientX - spacePanRef.current.startX;
      const dy = e.clientY - spacePanRef.current.startY;
      pan(dx - (t.offsetX - spacePanRef.current.offsetX), dy - (t.offsetY - spacePanRef.current.offsetY));
    },
    [pan, getTransform]
  );

  const handleSpacePanUp = useCallback(() => {
    spacePanRef.current = null;
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative overflow-hidden"
      style={{ background: "var(--color-canvas)", cursor: spaceHeld ? (spacePanRef.current ? "grabbing" : "grab") : "default" }}
      onDoubleClick={handleDoubleClick}
      onPointerDown={handleSpacePanDown}
      onPointerMove={handleSpacePanMove}
      onPointerUp={handleSpacePanUp}
    >
      {/* White overlay — covers all cards during open/close */}
      {openProgress > 0 && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: "#ffffff",
            opacity: openProgress,
            zIndex: 9998,
          }}
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
