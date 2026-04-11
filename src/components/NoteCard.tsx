import { useRef, useState } from "react";
import type { Note } from "../store/db";
import { useCardDrag } from "../hooks/useCardDrag";
import { CARD_W, CARD_H, CARD_CONTENT_W, CARD_RADIUS } from "../constants";

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
  note, scale, offsetX, offsetY, windowW, windowH,
  isOpen, openProgress, closingScrollOffset,
  onTap, onClose, onDragMove, onDragEnd, onBringToFront,
  children,
}: Props) {
  const [isHovered, setIsHovered] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { isDragging, dragRotation, handlePointerDown } = useCardDrag({
    noteId: note.id,
    positionX: note.positionX,
    positionY: note.positionY,
    scale,
    isOpen,
    openProgress,
    onTap,
    onDragMove,
    onDragEnd,
    onBringToFront,
  });

  const isImageCard = note.kind === "image";
  const cardW = isImageCard ? CARD_CONTENT_W : CARD_W;
  const cardH = isImageCard && note.imageAspect > 0 ? CARD_CONTENT_W * note.imageAspect : CARD_H;

  const t = openProgress;

  // Cards at t=0 are positioned in canvas-space (parent div handles offset+scale).
  // Cards at t>0 lerp to screen-space position.
  const canvasLeft = note.positionX - cardW / 2;
  const canvasTop = note.positionY - cardH / 2;

  const screenLeft = (windowW - cardW) / 2;
  const screenTop = 0;
  const cardScreenLeft = windowW / 2 + note.positionX * scale + offsetX - (cardW * scale) / 2;
  const cardScreenTop = windowH / 2 + note.positionY * scale + offsetY - (cardH * scale) / 2;

  const scl = t > 0 ? lerp(scale, 1, t) : 1;
  const visualLeft = t > 0 ? lerp(cardScreenLeft, screenLeft, t) : canvasLeft;
  const visualTop = t > 0 ? lerp(cardScreenTop, screenTop, t) : canvasTop;
  const editing = openProgress >= 1;

  const closingScrollY = !editing && openProgress > 0 && closingScrollOffset > 0
    ? -closingScrollOffset * openProgress
    : 0;

  return (
    <>
      <div
        className="absolute select-none pointer-events-auto"
        style={{
          left: visualLeft,
          top: visualTop,
          width: t > 0 ? cardW * scl : cardW,
          height: t > 0 ? cardH * scl : cardH,
          borderRadius: t > 0 ? CARD_RADIUS * scl * (1 - t) : CARD_RADIUS,
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
