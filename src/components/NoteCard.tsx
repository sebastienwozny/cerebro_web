import { useRef, useState, useCallback, type PointerEvent } from "react";
import type { Note } from "../store/db";

// ── Card dimensions (matching Swift constants) ──
const CARD_W = 800;
const CARD_H = 1131;
const CARD_CONTENT_W = 600;
const CARD_RADIUS = 16;

interface Props {
  note: Note;
  scale: number;
  offsetX: number;
  offsetY: number;
  windowW: number;
  windowH: number;
  isOpen: boolean;
  openProgress: number;
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
  onTap,
  onClose,
  onDragMove,
  onDragEnd,
  onBringToFront,
  children,
}: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const dragStart = useRef<{ px: number; py: number; noteX: number; noteY: number } | null>(null);

  const isImageCard = note.kind === "image";
  const cardW = isImageCard ? CARD_CONTENT_W : CARD_W;
  const cardH = isImageCard && note.imageAspect > 0 ? CARD_CONTENT_W * note.imageAspect : CARD_H;

  const t = openProgress;
  const w = lerp(cardW, windowW, t);
  const h = lerp(cardH, windowH, t);
  const scl = lerp(scale, 1, t);
  const radius = isImageCard ? 0 : lerp(CARD_RADIUS, 0, t);

  const liveMidX = windowW / 2 + note.positionX * scale + offsetX;
  const liveMidY = windowH / 2 + note.positionY * scale + offsetY;
  const cx = lerp(liveMidX, windowW / 2, t);
  const cy = lerp(liveMidY, windowH / 2, t);
  const editing = openProgress > 0.9;

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
      }
      if (isDragging || Math.abs(dx) + Math.abs(dy) > 4 / scale) {
        onDragMove(note.id, dragStart.current.noteX + dx, dragStart.current.noteY + dy);
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
    },
    [note.id, onTap, onDragEnd]
  );

  const showEditor = isOpen || openProgress > 0;

  return (
    <div
      className="absolute select-none pointer-events-auto"
      style={{
        left: cx - (w * scl) / 2,
        top: cy - (h * scl) / 2,
        width: w,
        height: h,
        transform: `scale(${scl})`,
        transformOrigin: "top left",
        borderRadius: radius,
        overflow: "hidden",
        cursor: isOpen ? "default" : isDragging ? "grabbing" : "grab",
        zIndex: isOpen ? 9999 : note.zOrder,
        transition: isDragging ? "none" : "box-shadow 0.2s ease",
        boxShadow: isDragging
          ? "0 30px 80px rgba(0,0,0,0.3)"
          : isHovered && !isOpen
            ? "0 20px 60px rgba(0,0,0,0.25)"
            : "0 4px 20px rgba(0,0,0,0.15)",
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onMouseEnter={() => !isOpen && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Card background */}
      {!isImageCard && (
        <div
          className="absolute inset-0 transition-colors duration-300"
          style={{
            borderRadius: radius,
            background: isOpen ? "var(--color-card-open)" : "var(--color-card)",
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

      {/* Editor content */}
      {showEditor && (
        <div
          className="absolute inset-0 overflow-y-auto p-10"
          style={{
            opacity: openProgress < 0.01 ? 0 : 1,
            pointerEvents: editing ? "auto" : "none",
          }}
        >
          {children}
        </div>
      )}

      {/* Fade gradient (card mode, note cards) */}
      {!isImageCard && openProgress < 0.1 && (
        <div
          className="absolute bottom-0 left-0 right-0 h-30 pointer-events-none"
          style={{
            background: "linear-gradient(to bottom, transparent, var(--color-card))",
            opacity: 1 - openProgress * 10,
            borderRadius: `0 0 ${radius}px ${radius}px`,
          }}
        />
      )}

      {/* Back button */}
      {openProgress > 0.1 && (
        <button
          className="absolute top-14 left-4 w-8 h-8 rounded-full border-none flex items-center justify-center text-lg cursor-pointer z-10 backdrop-blur-sm transition-colors"
          style={{
            opacity: openProgress,
            background: "rgba(128,128,128,0.3)",
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
    </div>
  );
}

export { CARD_W, CARD_H, CARD_CONTENT_W };
