import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Note } from "../store/db";
import { useCardDrag } from "../hooks/useCardDrag";
import { CARD_CONTENT_W, CARD_RADIUS } from "../constants";
import { getCardSize } from "../lib/cardDimensions";

interface Props {
  note: Note;
  scale: number;
  offsetX: number;
  offsetY: number;
  windowW: number;
  windowH: number;
  isOpen: boolean;
  isSelected: boolean;
  isDeleting: boolean;
  isPopping?: boolean;
  isAnimating?: boolean;
  openProgress: number;
  isClosing?: boolean;
  closingScrollOffset: number;
  hoverSuppressed: boolean;
  groupDragDelta: { dx: number; dy: number };
  groupDragRotation: number;
  onTap: (noteId: string) => void;
  onShiftTap: (noteId: string) => void;
  onClose: () => void;
  onDragStart: (noteId: string) => void;
  onDragMove: (noteId: string, dx: number, dy: number) => void;
  onDragEnd: (noteId: string) => void;
  onDragRotation?: (rotation: number) => void;
  onDragDuplicate?: (noteId: string) => void;
  onBringToFront: (noteId: string) => void;
  onResize?: (noteId: string, newScale: number) => void;
  onResizeEnd?: (noteId: string, oldScale: number) => void;
  children?: React.ReactNode;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function NoteCard({
  note, scale, offsetX, offsetY, windowW, windowH,
  isOpen, isSelected, isDeleting, isPopping, isAnimating, openProgress, isClosing, closingScrollOffset, hoverSuppressed, groupDragDelta, groupDragRotation,
  onTap, onShiftTap, onClose, onDragStart, onDragMove, onDragEnd, onDragRotation, onDragDuplicate, onBringToFront, onResize, onResizeEnd,
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
    onShiftTap,
    onDragStart,
    onDragMove,
    onDragEnd,
    onDragRotation,
    onDragDuplicate,
    onBringToFront,
  });

  // Clear hover when drag starts so it doesn't trigger on release
  useEffect(() => {
    if (isDragging) setIsHovered(false);
  }, [isDragging]);



  // Suppress scale after drag — re-enable when drag ends or selection changes
  const wasDraggedRef = useRef(false);
  useEffect(() => {
    if (isDragging || groupDragDelta.dx !== 0 || groupDragDelta.dy !== 0) {
      wasDraggedRef.current = true;
    } else {
      wasDraggedRef.current = false;
    }
  }, [isDragging, groupDragDelta]);

  const isImageCard = note.kind === "image";
  const { w: cardW, h: cardH } = getCardSize(note);
  // Base (unscaled) size — used as the animation target for open/close
  const { w: baseW, h: baseH } = getCardSize({ ...note, cardScale: 1 });

  // ── Resize handle logic ──
  const resizingRef = useRef(false);
  const resizeStartRef = useRef({ pointerX: 0, startScale: 1, direction: 1 });

  const makeResizeHandlers = (direction: 1 | -1) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      resizingRef.current = true;
      resizeStartRef.current = { pointerX: e.clientX, startScale: note.cardScale || 1, direction };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!resizingRef.current) return;
      const dx = (e.clientX - resizeStartRef.current.pointerX) * resizeStartRef.current.direction;
      const newScale = Math.max(0.3, resizeStartRef.current.startScale + dx / (cardW / (note.cardScale || 1)) / scale);
      onResize?.(note.id, newScale);
    },
    onPointerUp: () => {
      if (resizingRef.current) {
        onResizeEnd?.(note.id, resizeStartRef.current.startScale);
      }
      resizingRef.current = false;
    },
  });

  // Hero animation for image card close: capture image screen rect before overlay unmounts
  const closingImgRect = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    if (isImageCard && isClosing && !closingImgRect.current) {
      const img = document.querySelector(".note-editor-header-image img") as HTMLElement | null;
      if (img) {
        const r = img.getBoundingClientRect();
        closingImgRect.current = { x: r.left, y: r.top, w: r.width, h: r.height };
      }
    }
    if (!isClosing) closingImgRect.current = null;
  }, [isImageCard, isClosing]);

  const t = openProgress;

  const canvasLeft = note.positionX - cardW / 2 + groupDragDelta.dx;
  const canvasTop = note.positionY - cardH / 2 + groupDragDelta.dy;

  const screenLeft = (windowW - baseW) / 2;
  const screenTop = 0;
  const cardScreenLeft = windowW / 2 + note.positionX * scale + offsetX - (cardW * scale) / 2;
  const cardScreenTop = windowH / 2 + note.positionY * scale + offsetY - (cardH * scale) / 2;

  const scl = t > 0 ? lerp(scale, 1, t) : 1;
  const visualLeft = t > 0 ? lerp(cardScreenLeft, screenLeft, t) : canvasLeft;
  const visualTop = t > 0 ? lerp(cardScreenTop, screenTop, t) : canvasTop;
  const visualWidth = t > 0 ? cardW * scl : cardW;
  const visualHeight = t > 0 ? lerp(cardH * scale, Math.max(baseH, windowH), t) : cardH;
  const innerW = t > 0 ? cardW : cardW;
  const innerH = t > 0 ? visualHeight / scl : cardH;
  const editing = openProgress >= 1;


  const closingScrollY = !editing && openProgress > 0 && closingScrollOffset > 0
    ? -closingScrollOffset * openProgress
    : 0;

  // A follower is a card being moved by group drag (not the one being actively dragged)
  const isFollowing = !isDragging && (groupDragDelta.dx !== 0 || groupDragDelta.dy !== 0 || groupDragRotation !== 0);
  const rotation = isDragging ? dragRotation : groupDragRotation;

  return (
    <>
      <div
        className="absolute select-none pointer-events-auto"
        style={{
          left: visualLeft,
          top: visualTop,
          width: visualWidth,
          height: t > 0 ? visualHeight : cardH,
          zIndex: openProgress > 0 ? 9999 : note.zOrder,
          transform: isDeleting
            ? "scale(0)"
            : isDragging || isFollowing
                ? `rotate(${rotation}deg)`
                : t > 0
                  ? "none"
                  : (isSelected || isHovered) && !wasDraggedRef.current
                    ? "scale(1.02)"
                    : "none",
          transformOrigin: isDragging || isFollowing ? "top center" : "center",
          animation: isPopping ? "popIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards" : undefined,
          transition: isDeleting
            ? "transform 0.4s cubic-bezier(0.215, 0.61, 0.355, 1)"
            : isDragging || isFollowing
              ? "opacity 0.3s ease-out"
              : t > 0
                ? "none"
                : isAnimating
                  ? "left 0.35s cubic-bezier(0.25, 1, 0.5, 1), top 0.35s cubic-bezier(0.25, 1, 0.5, 1), transform 0.15s ease-out, box-shadow 0.15s ease-out"
                  : "transform 0.15s ease-out, box-shadow 0.15s ease-out",
        }}
        onMouseEnter={() => !isOpen && !hoverSuppressed && !isPopping && t < 0.1 && setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Clipped card content */}
        <div
          className="absolute inset-0"
          style={{
            contain: "layout style paint",
            borderRadius: t > 0 ? CARD_RADIUS * scl * (1 - t) : CARD_RADIUS,
            overflow: "hidden",
            cursor: isOpen ? "default" : isDragging ? "grabbing" : "grab",
            boxShadow: t > 0
              ? "none"
              : isSelected && openProgress < 0.1
                ? "0 0 0 8px var(--color-card), 0 4px 10px rgba(0,0,0,0.05)"
                : isHovered
                  ? "0 20px 40px rgba(0,0,0,0.05)"
                  : "0 4px 10px rgba(0,0,0,0.05)",
          }}
          onPointerDown={handlePointerDown}
        >
        {/* Inner wrapper */}
        <div
          style={{
            width: innerW,
            height: t > 0 ? innerH : cardH,
            transform: t > 0 ? `scale(${scl})` : "none",
            transformOrigin: "top left",
          }}
        >
          {/* Card background — skip for image cards */}
          {!isImageCard && (
            <div
              className="absolute inset-0"
              style={{
                borderRadius: CARD_RADIUS * (1 - t),
                background: `color-mix(in srgb, var(--color-card) ${Math.round((1 - t) * 100)}%, var(--color-card-open))`,
              }}
            />
          )}

          {/* Image card thumbnail — visible only at rest (t=0), hidden during open/close transitions */}
          {isImageCard && note.imageDataUrl && t === 0 && (
            <img
              src={note.imageDataUrl}
              alt=""
              className="absolute pointer-events-none"
              style={{
                top: 0,
                left: 0,
                width: cardW,
                height: cardH,
                objectFit: "cover",
              }}
              draggable={false}
            />
          )}

          {/* Selection border — white inside */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              borderRadius: CARD_RADIUS,
              border: "4px solid var(--color-selection-border)",
              opacity: isSelected && openProgress < 0.1 ? 1 : 0,
              transition: "opacity 0.15s ease-out",
              zIndex: 1,
            }}
          />

          {/* Editor content (card mode — clipped). Skip for image cards — thumbnail handles it. */}
          {!editing && !isImageCard && (
            <div
              className="absolute inset-0 flex justify-center"
              style={{
                pointerEvents: "none",
                paddingTop: 120,
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
                height: 200,
                background: "linear-gradient(to bottom, transparent 0%, var(--color-card) 70%)",
                opacity: 1 - openProgress * 10,
                borderRadius: `0 0 ${CARD_RADIUS}px ${CARD_RADIUS}px`,
              }}
            />
          )}

        </div>
        {/* Close clipped card content */}
        </div>

        {/* Resize handles (left & right center) — image cards only */}
        {isImageCard && t < 0.1 && !isDragging && (isHovered || isSelected) && (
          <>
            {/* Left handle */}
            <div
              className="absolute pointer-events-auto"
              style={{
                left: 0,
                top: "50%",
                transform: "translateY(-50%)",
                width: 48,
                height: 200,
                cursor: "ew-resize",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              {...makeResizeHandlers(-1)}
            >
              <div style={{ width: 8, height: cardH * 0.15, borderRadius: 4, background: "rgba(255,255,255,0.7)", boxShadow: "0 0 4px rgba(0,0,0,0.5)" }} />
            </div>
            {/* Right handle */}
            <div
              className="absolute pointer-events-auto"
              style={{
                right: 0,
                top: "50%",
                transform: "translateY(-50%)",
                width: 48,
                height: 200,
                cursor: "ew-resize",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              {...makeResizeHandlers(1)}
            >
              <div style={{ width: 8, height: cardH * 0.15, borderRadius: 4, background: "rgba(255,255,255,0.7)", boxShadow: "0 0 4px rgba(0,0,0,0.5)" }} />
            </div>
          </>
        )}
      </div>

      {/* Back button */}
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


      {/* Editor content (open mode) */}
      {editing && (
        <div
          ref={scrollRef}
          data-editor-overlay
          className="fixed inset-0 overflow-y-auto flex justify-center"
          style={{
            zIndex: 10000,
            paddingTop: 120,
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

      {/* Hero image for image card open/close transition — portal so it's not clipped */}
      {isImageCard && t > 0 && !editing && note.imageDataUrl && (() => {
        // Editor image target rect (centered, below 120px header)
        const editorImgW = CARD_CONTENT_W;
        const editorImgH = CARD_CONTENT_W * note.imageAspect;
        const editorImgX = (windowW - editorImgW) / 2;
        const editorImgY = 120;

        // Use captured rect for close (more accurate), computed rect for open
        const targetX = isClosing && closingImgRect.current ? closingImgRect.current.x : editorImgX;
        const targetY = isClosing && closingImgRect.current ? closingImgRect.current.y : editorImgY;
        const targetW = isClosing && closingImgRect.current ? closingImgRect.current.w : editorImgW;
        const targetH = isClosing && closingImgRect.current ? closingImgRect.current.h : editorImgH;

        return createPortal(
          <img
            src={note.imageDataUrl}
            alt=""
            style={{
              position: "fixed",
              left: lerp(cardScreenLeft, targetX, t),
              top: lerp(cardScreenTop, targetY, t),
              width: lerp(cardW * scale, targetW, t),
              height: lerp(cardH * scale, targetH, t),
              objectFit: "cover",
              zIndex: 10001,
              pointerEvents: "none",
              borderRadius: lerp(CARD_RADIUS * scale, 0, t),
            }}
            draggable={false}
          />,
          document.body,
        );
      })()}
    </>
  );
}

export default React.memo(NoteCard);
