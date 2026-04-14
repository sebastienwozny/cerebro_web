import React, { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { Note } from "../store/db";
import { useCardDrag } from "../hooks/useCardDrag";
import { useCardHover } from "../hooks/useCardHover";
import { useCardResize } from "../hooks/useCardResize";
import { useImageBrightness } from "../hooks/useImageBrightness";
import { CARD_CONTENT_W } from "../constants";
import { getCardSize, getHeaderImage } from "../lib/cardDimensions";

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
  onResize?: (noteId: string, newScale: number, newPosX: number, newPosY: number) => void;
  onResizeEnd?: (noteId: string, oldScale: number, oldPosX: number, oldPosY: number) => void;
  children?: React.ReactNode;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

const CORNER_PATH = "M65.4004 5.39844C65.4004 38.5355 38.5375 65.3984 5.40039 65.3984";
const CORNER_VIEWBOX = "0 0 71 71";
const CORNER_INSET = 15;
const CORNER_STROKE_W = 8;

interface CornerHandleProps {
  position: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  size: number;
  strokeColor: string;
  visible: boolean;
  resizeHandlers: { onPointerDown: (e: React.PointerEvent) => void };
}

function CornerHandle({ position, size, strokeColor, visible, resizeHandlers }: CornerHandleProps) {
  const posStyle: React.CSSProperties =
    position === "top-left" ? { left: CORNER_INSET, top: CORNER_INSET, cursor: "nwse-resize" } :
    position === "top-right" ? { right: CORNER_INSET, top: CORNER_INSET, cursor: "nesw-resize" } :
    position === "bottom-left" ? { left: CORNER_INSET, bottom: CORNER_INSET, cursor: "nesw-resize" } :
    { right: CORNER_INSET, bottom: CORNER_INSET, cursor: "nwse-resize" };

  const svgTransform =
    position === "top-left" ? "rotate(180deg)" :
    position === "top-right" ? "scaleY(-1)" :
    position === "bottom-left" ? "scaleX(-1)" :
    undefined;

  return (
    <div
      className="absolute"
      style={{
        ...posStyle,
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: visible ? 1 : 0,
        transition: "opacity 0.2s ease-out",
        pointerEvents: visible ? "auto" : "none",
      }}
      {...resizeHandlers}
    >
      <svg width={size} height={size} viewBox={CORNER_VIEWBOX} fill="none" style={svgTransform ? { transform: svgTransform } : undefined}>
        <path d={CORNER_PATH} stroke={strokeColor} strokeWidth={CORNER_STROKE_W / size * 71} strokeLinecap="round" />
      </svg>
    </div>
  );
}

function NoteCard({
  note, scale, offsetX, offsetY, windowW, windowH,
  isOpen, isSelected, isDeleting, isPopping, isAnimating, openProgress, isClosing, closingScrollOffset, hoverSuppressed, groupDragDelta, groupDragRotation,
  onTap, onShiftTap, onClose, onDragStart, onDragMove, onDragEnd, onDragRotation, onDragDuplicate, onBringToFront, onResize, onResizeEnd,
  children,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const headerImage = getHeaderImage(note);
  const isImageCard = headerImage !== null;

  const { w: cardW, h: cardH } = getCardSize(note);
  const cardRadius = Math.max(Math.min(cardW, cardH) * 0.10, 80);
  const { w: baseW, h: baseH } = getCardSize({ ...note, cardScale: 1 });

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

  const resizingRef = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const {
    isHovered, isPointerOver, suppressScale,
    onMouseEnter, onMouseLeave, onInteractionStart, onResizeEnd: onHoverResizeEnd,
  } = useCardHover({ isDragging, isResizingRef: resizingRef, cardRef, isOpen, hoverSuppressed, isPopping, openProgress });

  const { isResizing, makeResizeHandlers } = useCardResize({
    noteId: note.id,
    cardScale: note.cardScale || 1,
    positionX: note.positionX,
    positionY: note.positionY,
    baseW: cardW / (note.cardScale || 1),
    baseH: cardH / (note.cardScale || 1),
    canvasScale: scale,
    resizingRef,
    onResize,
    onResizeEnd,
    onInteractionStart,
    onResizeRelease: onHoverResizeEnd,
  });

  const isLightImage = useImageBrightness(headerImage?.dataUrl);

  // Hero animation for image card close: capture image screen rect before overlay unmounts
  const closingImgRect = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    if (isImageCard && isClosing && !closingImgRect.current) {
      const img = document.querySelector("[data-editor-overlay] .tiptap img") as HTMLElement | null;
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

  // Reset scroll to top when editor opens
  useLayoutEffect(() => {
    if (editing && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [editing]);

  const closingScrollY = !editing && openProgress > 0 && closingScrollOffset > 0
    ? -closingScrollOffset * openProgress
    : 0;

  // A follower is a card being moved by group drag (not the one being actively dragged)
  const isFollowing = !isDragging && (groupDragDelta.dx !== 0 || groupDragDelta.dy !== 0 || groupDragRotation !== 0);
  const rotation = isDragging ? dragRotation : groupDragRotation;

  return (
    <>
      <div
        ref={cardRef}
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
                  : (isSelected || isHovered) && !suppressScale && !isResizing
                    ? "scale(1.02)"
                    : "none",
          transformOrigin: isDragging || isFollowing ? "top center" : "center",
          animation: isPopping ? "popIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards" : undefined,
          transition: isDeleting
            ? "transform 0.4s cubic-bezier(0.215, 0.61, 0.355, 1)"
            : isDragging || isFollowing
              ? "transform 0.15s ease-out, opacity 0.3s ease-out"
              : t > 0
                ? "none"
                : isAnimating
                  ? "left 0.35s cubic-bezier(0.25, 1, 0.5, 1), top 0.35s cubic-bezier(0.25, 1, 0.5, 1), transform 0.15s ease-out"
                  : "transform 0.15s ease-out",
        }}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        {/* Clipped card content */}
        <div
          className="absolute inset-0"
          style={{
            contain: "layout style paint",
            borderRadius: t > 0 ? cardRadius * scl * (1 - t) : cardRadius,
            overflow: "hidden",
            cursor: isOpen ? "default" : isDragging ? "grabbing" : "grab",
            boxShadow: t > 0
              ? "none"
              : isSelected && openProgress < 0.1
                ? "0 0 0 8px var(--color-card), 0 4px 10px rgba(0,0,0,0.05)"
                : isHovered
                  ? "0 20px 50px -10px rgba(0,0,0,0.08), 0 50px 140px -15px rgba(0,0,0,0.06)"
                  : "0 10px 20px -12px rgba(0,0,0,0.15), 0 32px 40px -8px rgba(0,0,0,0.04)",
            transition: t > 0 ? "none" : "box-shadow 0.3s ease-out",
          }}
          onPointerDown={isResizing ? undefined : (e) => { onInteractionStart(); handlePointerDown(e); }}
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
                borderRadius: cardRadius * (1 - t),
                background: `color-mix(in srgb, var(--color-card) ${Math.round((1 - t) * 100)}%, var(--color-card-open))`,
              }}
            />
          )}

          {/* Image card thumbnail — visible only at rest (t=0), hidden during open/close transitions */}
          {isImageCard && headerImage && t === 0 && (
            <img
              src={headerImage.dataUrl}
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
              borderRadius: cardRadius,
              border: "4px solid var(--color-selection-border)",
              opacity: isSelected && openProgress < 0.1 ? 1 : 0,
              transition: "opacity 0.15s ease-out",
              zIndex: 1,
            }}
          />

          {/* Editor content (card mode — clipped). Image cards: only during close. */}
          {!editing && (!isImageCard || (isClosing && t > 0)) && (
            <div
              className="absolute inset-0 flex justify-center"
              style={{
                pointerEvents: "none",
                paddingTop: 120,
                transform: closingScrollY ? `translateY(${closingScrollY}px)` : "none",
              }}
            >
              <div className={isImageCard ? "image-card-closing" : undefined} style={{ width: CARD_CONTENT_W, ...(isImageCard ? { "--text-fade": t } as React.CSSProperties : {}) }}>
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
                borderRadius: `0 0 ${cardRadius}px ${cardRadius}px`,
              }}
            />
          )}

        </div>
        {/* Close clipped card content */}
        </div>

        {/* Resize handles — image cards only */}
        {isImageCard && openProgress === 0 && !isDragging && (() => {
          const showCorners = isPointerOver && !hoverSuppressed && !isSelected;
          const cornerSize = Math.max(Math.round(Math.min(cardW, cardH) * 0.10), 70);
          const strokeColor = isLightImage ? "rgba(0,0,0,0.2)" : "rgba(255,255,255,0.3)";
          return (
          <>
            <CornerHandle position="top-left" size={cornerSize} strokeColor={strokeColor} visible={showCorners} resizeHandlers={makeResizeHandlers(-1, -1)} />
            <CornerHandle position="top-right" size={cornerSize} strokeColor={strokeColor} visible={showCorners} resizeHandlers={makeResizeHandlers(1, -1)} />
            <CornerHandle position="bottom-left" size={cornerSize} strokeColor={strokeColor} visible={showCorners} resizeHandlers={makeResizeHandlers(-1, 1)} />
            <CornerHandle position="bottom-right" size={cornerSize} strokeColor={strokeColor} visible={showCorners} resizeHandlers={makeResizeHandlers(1, 1)} />
          </>
          );
        })()}
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
          <div
            className={isImageCard ? "image-card-open" : undefined}
            style={{
              width: "100%",
              maxWidth: CARD_CONTENT_W,
            }}
          >
            {children}
          </div>
        </div>
      )}

      {/* Hero image for image card open/close transition — portal so it's not clipped */}
      {isImageCard && t > 0 && !editing && headerImage && (() => {
        // Editor image target rect (centered, below 120px header)
        const editorImgW = CARD_CONTENT_W;
        const editorImgH = CARD_CONTENT_W * headerImage.aspect;
        const editorImgX = (windowW - editorImgW) / 2;
        const editorImgY = 120;

        // Use captured rect for close (more accurate), computed rect for open
        const targetX = isClosing && closingImgRect.current ? closingImgRect.current.x : editorImgX;
        const targetY = isClosing && closingImgRect.current ? closingImgRect.current.y : editorImgY;
        const targetW = isClosing && closingImgRect.current ? closingImgRect.current.w : editorImgW;
        const targetH = isClosing && closingImgRect.current ? closingImgRect.current.h : editorImgH;

        return createPortal(
          <img
            src={headerImage.dataUrl}
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
              borderRadius: lerp(cardRadius * scale, 0, t),
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
