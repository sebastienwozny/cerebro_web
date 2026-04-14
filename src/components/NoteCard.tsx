import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Note } from "../store/db";
import { useCardDrag } from "../hooks/useCardDrag";
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

function NoteCard({
  note, scale, offsetX, offsetY, windowW, windowH,
  isOpen, isSelected, isDeleting, isPopping, isAnimating, openProgress, isClosing, closingScrollOffset, hoverSuppressed, groupDragDelta, groupDragRotation,
  onTap, onShiftTap, onClose, onDragStart, onDragMove, onDragEnd, onDragRotation, onDragDuplicate, onBringToFront, onResize, onResizeEnd,
  children,
}: Props) {
  const [isHovered, setIsHovered] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
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

  const headerImage = getHeaderImage(note);
  const isImageCard = headerImage !== null;

  // Detect if the image is light or dark to pick handle color
  const [isLightImage, setIsLightImage] = useState(false);
  useEffect(() => {
    if (!headerImage) return;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const size = 32; // sample at low res
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, size, size);
      const data = ctx.getImageData(0, 0, size, size).data;
      let total = 0;
      for (let i = 0; i < data.length; i += 4) {
        total += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      }
      setIsLightImage(total / (size * size) > 160);
    };
    img.src = headerImage.dataUrl;
  }, [headerImage?.dataUrl]);

  const handleStrokeColor = isLightImage ? "rgba(0,0,0,0.2)" : "rgba(255,255,255,0.3)";

  const { w: cardW, h: cardH } = getCardSize(note);
  const cardRadius = Math.max(Math.min(cardW, cardH) * 0.10, 80);
  // Base (unscaled) size — used as the animation target for open/close
  const { w: baseW, h: baseH } = getCardSize({ ...note, cardScale: 1 });

  // ── Resize handle logic ──
  const resizingRef = useRef(false);
  const resizeStartRef = useRef({ pointerX: 0, startScale: 1, startPosX: 0, startPosY: 0, dirX: 1, dirY: 0 });

  const baseW_resize = cardW / (note.cardScale || 1);
  const baseH_resize = cardH / (note.cardScale || 1);

  // Global listeners for resize move/up so they fire even if the handle unmounts
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!resizingRef.current) return;
      const ref = resizeStartRef.current;
      const dx = (e.clientX - ref.pointerX) * ref.dirX;
      const newScale = Math.max(0.3, ref.startScale + dx / baseW_resize / scale);
      const deltaW = (newScale - ref.startScale) * baseW_resize;
      const deltaH = (newScale - ref.startScale) * baseH_resize;
      const newPosX = ref.startPosX + ref.dirX * deltaW / 2;
      const newPosY = ref.startPosY + ref.dirY * deltaH / 2;
      onResize?.(note.id, newScale, newPosX, newPosY);
    };
    const onUp = () => {
      if (resizingRef.current) {
        onResizeEnd?.(note.id, resizeStartRef.current.startScale, resizeStartRef.current.startPosX, resizeStartRef.current.startPosY);
      }
      resizingRef.current = false;
      setIsResizing(false);
      setIsHovered(false);
      resizeCaptureRef.current = null;
    };
    const onBlur = () => { if (resizingRef.current) onUp(); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  });

  const resizeCaptureRef = useRef<Element | null>(null);

  const makeResizeHandlers = (dirX: 1 | -1, dirY: -1 | 0 | 1) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      (e.target as Element).setPointerCapture(e.pointerId);
      resizeCaptureRef.current = e.target as Element;
      resizingRef.current = true;
      setIsResizing(true);
      resizeStartRef.current = { pointerX: e.clientX, startScale: note.cardScale || 1, startPosX: note.positionX, startPosY: note.positionY, dirX, dirY };
    },
  });

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
                  : (isSelected || isHovered) && !wasDraggedRef.current && !isResizing
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
                  ? "left 0.35s cubic-bezier(0.25, 1, 0.5, 1), top 0.35s cubic-bezier(0.25, 1, 0.5, 1), transform 0.15s ease-out"
                  : "transform 0.15s ease-out",
        }}
        onMouseEnter={() => !isOpen && !hoverSuppressed && !isPopping && !isResizing && t < 0.1 && setIsHovered(true)}
        onMouseLeave={() => !isResizing && setIsHovered(false)}
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
          onPointerDown={isResizing ? undefined : handlePointerDown}
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
        {isImageCard && t < 0.1 && !isDragging && (() => {
          const showCorners = isHovered && !isSelected;
          const cornerRef = Math.min(cardW, cardH);
          const cornerSize = Math.max(Math.round(cornerRef * 0.10), 70);
          const cornerInset = 15;
          const strokeW = 8;
          const cornerStyle = { opacity: showCorners ? 1 : 0, transition: "opacity 0.2s ease-out", pointerEvents: (showCorners ? "auto" : "none") as React.CSSProperties["pointerEvents"] };
          return (
          <>
            {/* Top-left corner */}
            <div
              className="absolute"
              style={{ ...cornerStyle, left: cornerInset, top: cornerInset, width: cornerSize, height: cornerSize, cursor: "nwse-resize", display: "flex", alignItems: "center", justifyContent: "center" }}
              {...makeResizeHandlers(-1, -1)}
            >
              <svg width={cornerSize} height={cornerSize} viewBox="0 0 71 71" fill="none" style={{ transform: "rotate(180deg)" }}>
                <path d="M65.4004 5.39844C65.4004 38.5355 38.5375 65.3984 5.40039 65.3984" stroke={handleStrokeColor} strokeWidth={strokeW / cornerSize * 71} strokeLinecap="round" />
              </svg>
            </div>
            {/* Top-right corner */}
            <div
              className="absolute"
              style={{ ...cornerStyle, right: cornerInset, top: cornerInset, width: cornerSize, height: cornerSize, cursor: "nesw-resize", display: "flex", alignItems: "center", justifyContent: "center" }}
              {...makeResizeHandlers(1, -1)}
            >
              <svg width={cornerSize} height={cornerSize} viewBox="0 0 71 71" fill="none" style={{ transform: "scaleY(-1)" }}>
                <path d="M65.4004 5.39844C65.4004 38.5355 38.5375 65.3984 5.40039 65.3984" stroke={handleStrokeColor} strokeWidth={strokeW / cornerSize * 71} strokeLinecap="round" />
              </svg>
            </div>
            {/* Bottom-left corner */}
            <div
              className="absolute"
              style={{ ...cornerStyle, left: cornerInset, bottom: cornerInset, width: cornerSize, height: cornerSize, cursor: "nesw-resize", display: "flex", alignItems: "center", justifyContent: "center" }}
              {...makeResizeHandlers(-1, 1)}
            >
              <svg width={cornerSize} height={cornerSize} viewBox="0 0 71 71" fill="none" style={{ transform: "scaleX(-1)" }}>
                <path d="M65.4004 5.39844C65.4004 38.5355 38.5375 65.3984 5.40039 65.3984" stroke={handleStrokeColor} strokeWidth={strokeW / cornerSize * 71} strokeLinecap="round" />
              </svg>
            </div>
            {/* Bottom-right corner */}
            <div
              className="absolute"
              style={{ ...cornerStyle, right: cornerInset, bottom: cornerInset, width: cornerSize, height: cornerSize, cursor: "nwse-resize", display: "flex", alignItems: "center", justifyContent: "center" }}
              {...makeResizeHandlers(1, 1)}
            >
              <svg width={cornerSize} height={cornerSize} viewBox="0 0 71 71" fill="none">
                <path d="M65.4004 5.39844C65.4004 38.5355 38.5375 65.3984 5.40039 65.3984" stroke={handleStrokeColor} strokeWidth={strokeW / cornerSize * 71} strokeLinecap="round" />
              </svg>
            </div>
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
