import { useRef, useState, useCallback, type PointerEvent } from "react";
import type { Note } from "../store/db";

// ── Card dimensions (matching Swift constants) ──
const CARD_W = 800;
const CARD_H = 1131;
const CARD_CONTENT_W = 600;
const CARD_RADIUS = 100;

interface Props {
  note: Note;
  scale: number;
  offsetX: number;
  offsetY: number;
  windowW: number;
  windowH: number;
  isOpen: boolean;
  openProgress: number;
  closingScrollOffset: number;
  onTap: () => void;
  onClose: () => void;
  onDragMove: (noteId: string, dx: number, dy: number) => void;
  onDragEnd: (noteId: string) => void;
  onBringToFront: (noteId: string) => void;
  children?: React.ReactNode;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export default function NoteCard({
  note,
  scale,
  offsetX,
  offsetY,
  windowW,
  windowH,
  isOpen,
  openProgress,
  closingScrollOffset,
  onTap,
  onClose,
  onDragMove,
  onDragEnd,
  onBringToFront,
  children,
}: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [dragRotation, setDragRotation] = useState(0);
  const dragStart = useRef<{ px: number; py: number; noteX: number; noteY: number } | null>(null);
  const lastMoveRef = useRef<{ x: number; time: number }>({ x: 0, time: 0 });

  // Spring physics for rotation — two modes matching Swift
  // Drag:    interactiveSpring(response: 0.15, dampingFraction: 0.6) → stiff=1750, damp=50
  // Release: spring(response: 0.4, dampingFraction: 0.7)            → stiff=246,  damp=22
  const springRef = useRef({ current: 0, velocity: 0, target: 0, stiffness: 1750, damping: 50 });
  const springRafRef = useRef<number>(0);
  const MAX_ROTATION = 2;

  const startSpring = useCallback(() => {
    if (springRafRef.current) return;
    const tick = () => {
      const s = springRef.current;
      const dt = 1 / 60;
      const force = s.stiffness * (s.target - s.current) - s.damping * s.velocity;
      s.velocity += force * dt;
      s.current += s.velocity * dt;
      setDragRotation(s.current);
      if (Math.abs(s.current - s.target) > 0.001 || Math.abs(s.velocity) > 0.01) {
        springRafRef.current = requestAnimationFrame(tick);
      } else {
        s.current = s.target;
        setDragRotation(s.target);
        springRafRef.current = 0;
      }
    };
    springRafRef.current = requestAnimationFrame(tick);
  }, []);

  const isImageCard = note.kind === "image";
  const cardW = isImageCard ? CARD_CONTENT_W : CARD_W;
  const cardH = isImageCard && note.imageAspect > 0 ? CARD_CONTENT_W * note.imageAspect : CARD_H;

  const t = openProgress;
  const tFast = t;

  // Cards at t=0 are positioned in canvas-space (parent div handles offset+scale).
  // Cards at t>0 lerp to screen-space position.
  const canvasLeft = note.positionX - cardW / 2;
  const canvasTop = note.positionY - cardH / 2;

  // Screen-space positions for open animation
  const screenLeft = (windowW - cardW) / 2;
  const screenTop = 0;
  // Where the card currently is on screen (canvas-space → screen-space)
  const cardScreenLeft = windowW / 2 + note.positionX * scale + offsetX - (cardW * scale) / 2;
  const cardScreenTop = windowH / 2 + note.positionY * scale + offsetY - (cardH * scale) / 2;

  const scl = t > 0 ? lerp(scale, 1, t) : 1; // in canvas layer, scale is on parent
  const visualLeft = t > 0 ? lerp(cardScreenLeft, screenLeft, t) : canvasLeft;
  const visualTop = t > 0 ? lerp(cardScreenTop, screenTop, t) : canvasTop;
  const editing = openProgress >= 1;
  const scrollRef = useRef<HTMLDivElement>(null);

  // During close, content slides from scrolled position back to top
  const closingScrollY = !editing && openProgress > 0 && closingScrollOffset > 0
    ? -closingScrollOffset * openProgress
    : 0;

  // ── Drag ──
  const handlePointerDown = useCallback(
    (e: PointerEvent) => {
      if (isOpen || openProgress > 0.1) return;
      if (e.button !== 0) return;
      dragStart.current = { px: e.clientX, py: e.clientY, noteX: note.positionX, noteY: note.positionY };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      onBringToFront(note.id);
    },
    [isOpen, openProgress, note.positionX, note.positionY, note.id, onBringToFront]
  );

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      if (!dragStart.current) return;
      const dx = (e.clientX - dragStart.current.px) / scale;
      const dy = (e.clientY - dragStart.current.py) / scale;
      if (!isDragging && Math.abs(dx) + Math.abs(dy) > 4 / scale) {
        setIsDragging(true);
        lastMoveRef.current = { x: e.clientX, time: performance.now() };
      }
      if (isDragging || Math.abs(dx) + Math.abs(dy) > 4 / scale) {
        onDragMove(note.id, dragStart.current.noteX + dx, dragStart.current.noteY + dy);
        // Velocity-based rotation (matching Swift interactiveSpring)
        const now = performance.now();
        const dt = Math.max(now - lastMoveRef.current.time, 1);
        const vx = (e.clientX - lastMoveRef.current.x) / dt;
        const vxPerSec = vx * 1000; // convert px/ms to px/s
        const target = Math.max(-MAX_ROTATION, Math.min(MAX_ROTATION, (vxPerSec / 800) * MAX_ROTATION));
        springRef.current.stiffness = 200;
        springRef.current.damping = 12;
        springRef.current.target = target;
        startSpring();
        lastMoveRef.current = { x: e.clientX, time: now };
      }
    },
    [scale, isDragging, note.id, onDragMove]
  );

  const handlePointerUp = useCallback(
    (e: PointerEvent) => {
      if (!dragStart.current) return;
      const dx = Math.abs(e.clientX - dragStart.current.px);
      const dy = Math.abs(e.clientY - dragStart.current.py);
      if (dx + dy < 4) {
        onTap();
      } else {
        onDragEnd(note.id);
      }
      dragStart.current = null;
      setIsDragging(false);
      // Softer spring for return (matches Swift .spring(response: 0.4, dampingFraction: 0.7))
      springRef.current.stiffness = 80;
      springRef.current.damping = 6;
      springRef.current.target = 0;
      startSpring();
    },
    [note.id, onTap, onDragEnd]
  );

  return (
    <>
    <div
      className="absolute select-none pointer-events-auto"
      style={{
        left: visualLeft,
        top: visualTop,
        width: t > 0 ? cardW * scl : cardW,
        height: t > 0 ? cardH * scl : cardH,
        borderRadius: t > 0 ? CARD_RADIUS * scl * (1 - tFast) : CARD_RADIUS,
        overflow: "hidden",
        cursor: isOpen ? "default" : isDragging ? "grabbing" : "grab",
        zIndex: openProgress > 0 ? 9999 : note.zOrder,
        transform: isDragging
          ? `translate3d(0,0,0) rotate(${dragRotation}deg)`
          : isHovered && t < 0.1
            ? "translate3d(0,0,0) scale(1.02)"
            : "translate3d(0,0,0)",
        transformOrigin: isDragging ? "top center" : "center",
        transition: isDragging ? "none" : "transform 0.15s ease-out, box-shadow 0.15s ease-out",
        boxShadow: t > 0
          ? "none"
          : isDragging
            ? "0 20px 40px rgba(0,0,0,0.08)"
            : isHovered
              ? "0 20px 40px rgba(0,0,0,0.05)"
              : "0 4px 10px rgba(0,0,0,0.05)",
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onMouseEnter={() => !isOpen && t < 0.1 && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Inner wrapper — scales content from cardW×cardH to fit the visual box */}
      <div
        style={{
          width: cardW,
          height: cardH,
          transform: t > 0 ? `scale(${scl})` : "none",
          transformOrigin: "top left",
        }}
      >
        {/* Card background */}
        {!isImageCard && (
          <div
            className="absolute inset-0"
            style={{
              borderRadius: CARD_RADIUS * (1 - t),
              background: `color-mix(in srgb, var(--color-card) ${Math.round((1 - t) * 100)}%, #ffffff)`,
            }}
          />
        )}

        {/* Image card thumbnail */}
        {isImageCard && note.imageDataUrl && openProgress < 0.01 && (
          <img
            src={note.imageDataUrl}
            alt=""
            className="absolute top-0 left-0 object-cover pointer-events-none"
            style={{ width: cardW, height: cardH }}
            draggable={false}
          />
        )}

        {/* Editor content (card mode — clipped) */}
        {!editing && (
          <div
            className="absolute inset-0 flex justify-center"
            style={{
              pointerEvents: "none",
              paddingTop: 150,
              transform: closingScrollY ? `translateY(${closingScrollY}px)` : "none",
            }}
          >
            <div style={{ width: CARD_CONTENT_W }}>
              {children}
            </div>
          </div>
        )}

        {/* Fade gradient (card mode) */}
        {!isImageCard && openProgress < 0.1 && (
          <div
            className="absolute bottom-0 left-0 right-0 pointer-events-none"
            style={{
              height: 120,
              background: "linear-gradient(to bottom, transparent, var(--color-card))",
              opacity: 1 - openProgress * 10,
              borderRadius: `0 0 ${CARD_RADIUS}px ${CARD_RADIUS}px`,
            }}
          />
        )}
      </div>
    </div>
    {/* Back button — slides in from left */}
    {openProgress > 0 && (
      <button
        className="fixed top-6 w-10 h-10 rounded-full border-none flex items-center justify-center text-xl cursor-pointer backdrop-blur-sm"
        style={{
          zIndex: 10001,
          left: lerp(-50, 20, t),
          opacity: t,
          background: "rgba(128,128,128,0.15)",
          color: "var(--color-text-muted)",
        }}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        ‹
      </button>
    )}
    {/* Editor content (open mode — full screen scroll, scrollbar at browser edge) */}
    {editing && (
      <div
        ref={scrollRef}
        data-editor-overlay
        className="fixed inset-0 overflow-y-auto flex justify-center"
        style={{
          zIndex: 10000,
          paddingTop: 150,
          paddingBottom: 40,
          paddingLeft: 20,
          paddingRight: 20,
        }}
      >
        <div style={{ width: "100%", maxWidth: CARD_CONTENT_W }}>
          {children}
        </div>
      </div>
    )}
    </>
  );
}

export { CARD_W, CARD_H, CARD_CONTENT_W };
