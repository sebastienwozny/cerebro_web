import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Note } from "../store/db";
import { useCardDrag } from "../hooks/useCardDrag";
import { useCardHover } from "../hooks/useCardHover";
import { useCardResize } from "../hooks/useCardResize";
import { useImageBrightness } from "../hooks/useImageBrightness";
import { CARD_CONTENT_W } from "../constants";
import { getCardSize, getHeaderMedia, getOpenMediaSize, OPEN_MEDIA_MAX_W } from "../lib/cardDimensions";
import PersistentVideoPlayer, { prewarmAudio } from "./PersistentVideoPlayer";

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
  spaceHeld: boolean;
  groupDragDelta: { dx: number; dy: number };
  groupDragRotation: number;
  /** Per-card position overrides driven by an imperative animation (gsap-
   *  driven reorder/undo). When set, replaces note.positionX/Y so React
   *  state can reflect mid-flight visual position without writing to the
   *  database every frame. */
  overrideX?: number;
  overrideY?: number;
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
  /** When true, render only the persistent video portal — no card visual.
   *  Used by the canvas-listed card while a sister open card handles the visual,
   *  so the <video> element never remounts on tap. */
  isShadowInstance?: boolean;
  /** When true, skip rendering the persistent video portal. Used by the open card
   *  while its canvas-listed counterpart owns the shared <video>. */
  suppressVideoPortal?: boolean;
  children?: React.ReactNode;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/** Quadratic Bezier interpolation: P(t) = (1-t)²·P0 + 2(1-t)t·C + t²·P1.
 *  Used to bend the card's open/close trajectory into an arc instead of
 *  a straight line — the control point is positioned above the segment
 *  midpoint, so the path bows upward. */
function qbez(p0: number, c: number, p1: number, t: number): number {
  const u = 1 - t;
  return u * u * p0 + 2 * u * t * c + t * t * p1;
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
      className="absolute flex items-center justify-center transition-opacity duration-200 ease-out"
      style={{
        ...posStyle,
        width: size,
        height: size,
        opacity: visible ? 1 : 0,
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
  isOpen, isSelected, isDeleting, isPopping, openProgress, isClosing, closingScrollOffset, hoverSuppressed, spaceHeld, groupDragDelta, groupDragRotation, overrideX, overrideY,
  onTap, onShiftTap, onClose, onDragStart, onDragMove, onDragEnd, onDragRotation, onDragDuplicate, onBringToFront, onResize, onResizeEnd,
  isShadowInstance, suppressVideoPortal,
  children,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Shadow fade-in on mount: useEffect fires after paint, so the browser
  // renders the transparent shadow first, then the transition kicks in.
  const [shadowReady, setShadowReady] = useState(false);
  useEffect(() => {
    requestAnimationFrame(() => setShadowReady(true));
  }, []);

  const headerMedia = getHeaderMedia(note);
  const isMediaCard = headerMedia !== null;
  // Both image and video cards use the same layout treatment.
  const isImageCard = isMediaCard;
  const headerDataUrl = headerMedia
    ? headerMedia.type === "image" ? headerMedia.dataUrl : headerMedia.posterDataUrl
    : null;

  const { w: cardW, h: cardH } = getCardSize(note);
  const isUrlCard = headerMedia?.type === "image" && !!headerMedia.sourceUrl;
  const cardRadius = Math.max(Math.min(cardW, cardH) * 0.07, 50);
  const { w: baseW, h: baseH } = getCardSize({ ...note, cardScale: 1 });

  const { isDragging, isPressed, dragRotation, handlePointerDown } = useCardDrag({
    noteId: note.id,
    positionX: note.positionX,
    positionY: note.positionY,
    scale,
    isOpen,
    openProgress,
    onTap,
    onShiftTap,
    onDragStart: (noteId: string) => { onInteractionStart(); onDragStart(noteId); },
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

  const isLightImage = useImageBrightness(headerDataUrl ?? undefined);

  // Pre-decode the header image once at idle so the open animation
  // doesn't pay the decode cost (especially noticeable on URL screenshot
  // cards whose WebP source can be 1+ MB). The browser caches decoded
  // pixels by `src`, so subsequent <img> instances with the same src
  // (e.g. the hero image during the open animation) hit the cache.
  useEffect(() => {
    if (!headerDataUrl) return;
    const cb = () => {
      const probe = new Image();
      probe.src = headerDataUrl;
      probe.decode().catch(() => { /* aborted/replaced — harmless */ });
    };
    if (typeof requestIdleCallback !== "undefined") {
      const id = requestIdleCallback(cb);
      return () => cancelIdleCallback(id);
    }
    const tid = setTimeout(cb, 200);
    return () => clearTimeout(tid);
  }, [headerDataUrl]);

  // Hero animation for media card close: capture header media screen rect
  // before overlay unmounts. Look for the first <img>/<video> in the editor.
  const closingImgRect = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    if (isMediaCard && isClosing && !closingImgRect.current) {
      const media = document.querySelector("[data-editor-overlay] .tiptap img, [data-editor-overlay] .tiptap .video-block-wrap") as HTMLElement | null;
      if (media) {
        const r = media.getBoundingClientRect();
        closingImgRect.current = { x: r.left, y: r.top, w: r.width, h: r.height };
      }
    }
    if (!isClosing) closingImgRect.current = null;
  }, [isMediaCard, isClosing]);

  const t = openProgress;

  // Pointer-over tracking independent of drag/hover interaction logic, so the
  // hover video keeps playing during a drag as long as the cursor is on the
  // card (per product spec).
  const [cursorInside, setCursorInside] = useState(false);

  // True for ~150ms whenever the user presses or releases the card. The
  // scale 1.02→1.0 ease-out runs at the instant of click (not at the drag
  // threshold 8px later), and the symmetric 1.0→hover ease runs on
  // release. Off otherwise so the per-frame rotation spring during drag
  // isn't re-interpolated by CSS.
  const [transformEasing, setTransformEasing] = useState(false);
  useEffect(() => {
    setTransformEasing(true);
    const t = setTimeout(() => setTransformEasing(false), 150);
    return () => clearTimeout(t);
  }, [isPressed]);

  // During open/close the main card div isn't rendered (shadow mode), so
  // pointerEnter/Leave never fire — cursorInside would stay stuck at whatever
  // it was before the tap, causing the video to auto-resume right after close
  // even if the user's pointer is no longer on the card. Reset whenever
  // hover is suppressed so the card requires a fresh pointer-enter.
  useEffect(() => {
    if (hoverSuppressed || isShadowInstance) setCursorInside(false);
  }, [hoverSuppressed, isShadowInstance]);

  // editorScrollY is managed imperatively inside PersistentVideoPlayer via a
  // ref + direct DOM update on scroll — keeping it in React state caused
  // async re-renders that fought the imperative update and produced lag.

  const posX = overrideX ?? note.positionX;
  const posY = overrideY ?? note.positionY;
  const canvasLeft = posX - cardW / 2 + groupDragDelta.dx;
  const canvasTop = posY - cardH / 2 + groupDragDelta.dy;

  const screenLeft = (windowW - baseW) / 2;
  const screenTop = 0;
  const cardScreenLeft = windowW / 2 + posX * scale + offsetX - (cardW * scale) / 2;
  const cardScreenTop = windowH / 2 + posY * scale + offsetY - (cardH * scale) / 2;

  const scl = t > 0 ? lerp(scale, 1, t) : 1;
  // Open/close path is a quadratic Bezier with the control point pushed
  // *below* the midpoint so the card sags downward along its trajectory
  // — visually reads as "coming from below" toward the open position.
  // Arc height scales with travel distance (capped) so short hops don't
  // get a giant useless bow.
  let visualLeft: number;
  let visualTop: number;
  if (t > 0) {
    const midX = (cardScreenLeft + screenLeft) / 2;
    const midY = (cardScreenTop + screenTop) / 2;
    const dx = screenLeft - cardScreenLeft;
    const dy = screenTop - cardScreenTop;
    const dist = Math.hypot(dx, dy);
    const arcHeight = Math.min(dist * 0.15, 100);
    const ctrlX = midX;
    const ctrlY = midY + arcHeight;
    visualLeft = qbez(cardScreenLeft, ctrlX, screenLeft, t);
    visualTop = qbez(cardScreenTop, ctrlY, screenTop, t);
  } else {
    visualLeft = canvasLeft;
    visualTop = canvasTop;
  }
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

  // Resize corners — same JSX rendered either inside the card (image cards)
  // or inside the PVP overlay (video cards, since the PVP covers the card).
  const cornerOverlay = isImageCard && openProgress === 0 && !isDragging ? (() => {
    const showCorners = isPointerOver && !hoverSuppressed && !isSelected;
    // Corner handles match the card's rounded corner curve. The card
    // radius formula was tightened from 0.10 to 0.07 above; mirror that
    // here so the handle's arc roughly traces the card's actual curve
    // instead of extending well past it onto the straight edge.
    const cornerSize = Math.max(Math.round(Math.min(cardW, cardH) * 0.07), 50);
    const strokeColor = isLightImage ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.35)";
    return (
      <>
        <CornerHandle position="top-left" size={cornerSize} strokeColor={strokeColor} visible={showCorners} resizeHandlers={makeResizeHandlers(-1, -1)} />
        <CornerHandle position="top-right" size={cornerSize} strokeColor={strokeColor} visible={showCorners} resizeHandlers={makeResizeHandlers(1, -1)} />
        <CornerHandle position="bottom-left" size={cornerSize} strokeColor={strokeColor} visible={showCorners} resizeHandlers={makeResizeHandlers(-1, 1)} />
        <CornerHandle position="bottom-right" size={cornerSize} strokeColor={strokeColor} visible={showCorners} resizeHandlers={makeResizeHandlers(1, 1)} />
      </>
    );
  })() : null;
  const isVideoCard = headerMedia?.type === "video";

  return (
    <>
      {!isShadowInstance && (
      // Positioner: handles canvas pan/zoom + this card's canvas position
      // via the --pan-x/--pan-y/--zoom CSS variables inherited from the
      // canvas layer. transform-origin top-left so scale(--zoom) zooms
      // positions outward from the canvas origin, not from the card's
      // own center. The inner div below keeps its own transforms
      // (rotate during drag, scale on hover, etc.) with their own
      // transform-origin — splitting these into two divs keeps the
      // origins independent.
      <div
        className="absolute"
        style={{
          left: 0,
          top: 0,
          width: visualWidth,
          height: t > 0 ? visualHeight : cardH,
          transformOrigin: "top left",
          transform: `translate3d(var(--pan-x, 0px), var(--pan-y, 0px), 0) scale(var(--zoom, 1)) translate3d(${visualLeft}px, ${visualTop}px, 0)`,
          zIndex: openProgress > 0 && !isShadowInstance ? "var(--z-card-open)" : note.zOrder,
        }}
      >
      <div
        ref={cardRef}
        className="absolute inset-0 select-none pointer-events-auto"
        style={{
          // CSS containment: layout + style only (no `paint` — that would
          // clip the card's drop shadow at its bounds). Tells the browser
          // the card's children won't affect outside layout/style, so the
          // compositor can skip work for unrelated cards.
          // (We avoid `content-visibility: auto` for the same reason — it
          // implies paint containment and clips the shadow. The JS cull in
          // Canvas.tsx already covers off-screen pruning.)
          contain: "layout style",
          transform: isDeleting
            ? "scale(0)"
            : isDragging
                // Drag returns the card to its base size — even if it was
                // hover-scaled the moment before drag started — so picking
                // up feels like "lifting" out of the hover state.
                ? `rotate(${rotation}deg)`
                : isFollowing
                  ? `rotate(${rotation}deg)`
                  : t > 0
                    ? "none"
                    : isHovered && !isSelected && !suppressScale && !isResizing && !isPressed
                      // isPressed overrides hover scale so clicking drops the
                      // card to base size immediately (with the easing window
                      // armed by the transformEasing effect above). We use
                      // `scale(1)` rather than `none` so CSS transitions
                      // between the two interpolate cleanly — browsers
                      // sometimes skip the animation when going to/from
                      // `transform: none`.
                      ? "scale(1.02)"
                      : "scale(1)",
          transformOrigin: isDragging || isFollowing ? "top center" : "center",
          animation: isPopping ? "popIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards" : undefined,
          transition: isDeleting
            ? "transform 0.4s cubic-bezier(0.215, 0.61, 0.355, 1)"
            : isDragging || isFollowing
              // Transform updates every frame during drag/follow (rotation
              // spring, drag delta); a permanent transition would lag the
              // per-frame updates. But on the very first ~150ms of drag,
              // transformEasing lets the scale 1.02→1.0 transition smoothly
              // before falling back to instant per-frame updates.
              ? transformEasing
                ? "transform 0.15s ease-out, opacity 0.3s ease-out"
                : "opacity 0.3s ease-out"
              : t > 0
                ? "none"
                : "transform 0.15s ease-out",
        }}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onPointerEnter={() => { if (!isDragging && !isResizing && !hoverSuppressed) setCursorInside(true); }}
        onPointerLeave={(e) => { if (!isDragging && !isResizing) { const r = cardRef.current?.getBoundingClientRect(); if (r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) return; setCursorInside(false); } }}
      >
        {/* Clipped card content */}
        <div
          className="absolute inset-0"
          style={{
            contain: "layout style paint",
            borderRadius: t > 0 ? cardRadius * scl * (1 - t) : cardRadius,
            overflow: "hidden",
            cursor: isOpen ? "default" : isDragging ? "grabbing" : "grab",
            boxShadow: t > 0 || !shadowReady
              ? "var(--shadow-card-invisible)"
              : isSelected && openProgress < 0.1
                ? "var(--shadow-card-selected)"
                // Drag/follow drops to rest shadow to match the size reset
                // (the card no longer reads as "hover-lifted" once you start
                // moving it).
                : isHovered && !isDragging && !isFollowing
                  ? "var(--shadow-card-hover)"
                  : "var(--shadow-card-rest)",
            transition: "box-shadow 0.2s ease-out",
          }}
          onPointerDown={isResizing || spaceHeld ? undefined : (e) => {
            if (headerMedia?.type === "video") prewarmAudio(headerMedia.blockId);
            handlePointerDown(e);
          }}
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

          {/* Media card thumbnail — visible only at rest (t=0), hidden during open/close transitions */}
          {isMediaCard && headerMedia?.type === "image" && t === 0 && (
            <img
              src={headerMedia.dataUrl}
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
              decoding="async"
            />
          )}
          {/* Card's own poster — shown only at rest (no PVP mounted). When
              the PVP takes over, rendering both would put two posters on
              different compositor layers that can subpixel-misalign under
              rotation, which reads as a brightness flicker on the video. */}
          {isMediaCard && headerMedia?.type === "video" && t === 0 && !cursorInside && !isResizing && (
            <img
              src={headerMedia.posterDataUrl}
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
              decoding="async"
            />
          )}


          {/* Selection border — white inside */}
          <div
            className="absolute inset-0 pointer-events-none border-4 border-selection-border transition-opacity duration-150 ease-out z-1"
            style={{
              borderRadius: cardRadius,
              opacity: isSelected && openProgress < 0.1 ? 1 : 0,
            }}
          />

          {/* Editor content (card mode — clipped). Image cards: only
              during close. Bottom fade is a `mask-image` on the wrapper
              (replaces the previous gradient overlay div, whose AA edge
              produced sub-pixel stipple under transform scaling). For
              text cards we mask the bottom 200px regardless of
              openProgress; the wrapper unmounts at `editing=true` and
              the editor overlay takes over. */}
          {!editing && (!isImageCard || (isClosing && t > 0)) && (() => {
            // Bottom fade size shrinks as the card opens, so the mask
            // dissolves smoothly rather than popping off when the wrapper
            // unmounts at `editing=true`.
            const fadePx = Math.round(200 * (1 - t));
            const maskGradient = `linear-gradient(to bottom, black 0, black calc(100% - ${fadePx}px), transparent 100%)`;
            return (
            <div
              className="absolute inset-0 flex justify-center pointer-events-none pt-25"
              style={{
                transform: closingScrollY ? `translateY(${closingScrollY}px)` : "none",
                maskImage: !isImageCard ? maskGradient : undefined,
                WebkitMaskImage: !isImageCard ? maskGradient : undefined,
              }}
            >
              <div className={isImageCard ? "image-card-closing" : undefined} style={{ width: CARD_CONTENT_W, ...(isImageCard ? { "--text-fade": t } as React.CSSProperties : {}) }}>
                {children}
              </div>
            </div>
            );
          })()}

        </div>
        {/* Close clipped card content */}
        {/* Resize handles — image cards render them here, INSIDE cardRef so
            the delete scale(0) shrinks them in lockstep with the card.
            Video cards render them via PVP (passed as children) so they
            sit above the video. */}
        {!isVideoCard && cornerOverlay}
        </div>
        {/* Hairline card border — text cards only (no header media).
            Image/video/URL cards are full-bleed and the border would
            sit awkwardly over the media. */}
        {!isMediaCard && t === 0 && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              borderRadius: cardRadius,
              border: "1px solid var(--color-card-border)",
            }}
          />
        )}
      </div>
      </div>
      )}

      {/* Back button */}
      {!isShadowInstance && openProgress > 0 && (
        <button
          className="fixed top-6 w-10 h-10 rounded-full border-none flex items-center justify-center text-xl cursor-pointer backdrop-blur-sm z-(--z-editor-controls) bg-back-button-bg text-text-muted"
          style={{
            left: lerp(-50, 20, t),
            opacity: t,
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
      {!isShadowInstance && editing && (
        <div
          ref={scrollRef}
          data-editor-overlay
          className="fixed inset-0 overflow-y-auto flex justify-center z-(--z-editor-overlay) pt-25 pb-10 px-5 bg-card-open"
        >
          {(() => {
            // Aspect-aware hero width on image/video cards: landscape → wider,
            // portrait → narrower. The wrapper max-width is the wider of the
            // hero and the text reading column (CARD_CONTENT_W) so the hero
            // can extend past the text width without clipping. CSS
            // (`.image-card-open`) re-narrows non-hero blocks back to the
            // reading column via `--hero-w`.
            const heroSize = isMediaCard && headerMedia && !isUrlCard
              ? getOpenMediaSize(headerMedia.aspect, windowW, windowH)
              : null;
            const wrapperMaxW = isUrlCard
              ? Math.min(windowW - 80, OPEN_MEDIA_MAX_W)
              : heroSize
                ? Math.max(heroSize.width, CARD_CONTENT_W)
                : CARD_CONTENT_W;
            const wrapperStyle: React.CSSProperties = {
              width: "100%",
              maxWidth: wrapperMaxW,
            };
            if (heroSize) {
              (wrapperStyle as React.CSSProperties & Record<string, string>)[
                "--hero-w"
              ] = `${heroSize.width}px`;
            }
            return (
              <div
                className={[
                  isImageCard ? "image-card-open" : "",
                  isUrlCard ? "url-card-open" : "",
                ].filter(Boolean).join(" ") || undefined}
                style={wrapperStyle}
              >
                {children}
              </div>
            );
          })()}
        </div>
      )}

      {/* Hero image for image-card open/close transition — portal so it's not
          clipped. Video cards use PersistentVideoPlayer below instead. */}
      {!isShadowInstance && isMediaCard && headerMedia?.type === "image" && t > 0 && !editing && headerDataUrl && (() => {
        // URL-screenshot cards open with a wider hero. Other image cards
        // size the hero by aspect ratio (landscape wider, portrait narrower)
        // via `getOpenMediaSize`, capped by the viewport.
        const sized = isUrlCard
          ? { width: Math.min(windowW - 80, OPEN_MEDIA_MAX_W), height: Math.min(windowW - 80, OPEN_MEDIA_MAX_W) * headerMedia.aspect }
          : getOpenMediaSize(headerMedia.aspect, windowW, windowH);
        const editorImgW = sized.width;
        const editorImgH = sized.height;
        const editorImgX = (windowW - editorImgW) / 2;
        const editorImgY = 100;

        const targetX = isClosing && closingImgRect.current ? closingImgRect.current.x : editorImgX;
        const targetY = isClosing && closingImgRect.current ? closingImgRect.current.y : editorImgY;
        const targetW = isClosing && closingImgRect.current ? closingImgRect.current.w : editorImgW;
        const targetH = isClosing && closingImgRect.current ? closingImgRect.current.h : editorImgH;

        // Match the qbez arc used by NoteCard / PVP so the hero image
        // travels along the same curved path during open/close.
        const hMidX = (cardScreenLeft + targetX) / 2;
        const hMidY = (cardScreenTop + targetY) / 2;
        const hDist = Math.hypot(targetX - cardScreenLeft, targetY - cardScreenTop);
        const hArc = Math.min(hDist * 0.15, 100);

        return createPortal(
          <img
            src={headerDataUrl}
            alt=""
            style={{
              position: "fixed",
              left: qbez(cardScreenLeft, hMidX, targetX, t),
              top: qbez(cardScreenTop, hMidY + hArc, targetY, t),
              width: lerp(cardW * scale, targetW, t),
              height: lerp(cardH * scale, targetH, t),
              objectFit: "cover",
              zIndex: "var(--z-editor-controls)",
              pointerEvents: "none",
              borderRadius: lerp(cardRadius * scale, 8, t),
            }}
            draggable={false}
            decoding="async"
          />,
          document.body,
        );
      })()}

      {/* Persistent video player — one <video> element that spans hover →
          open → close. No swap, continuous playback. */}
      {headerMedia?.type === "video" && !suppressVideoPortal && (() => {
        // For `playing`, intentionally skip the hoverSuppressed gate. Otherwise
        // `playing` flips false→true the instant another card finishes closing
        // (openNoteId→null lifts hoverSuppressed), which triggers a fresh
        // play() call — Chrome re-composites the video layer and the color
        // path momentarily resolves to its non-color-managed branch, reading
        // as a brightness flash on the canvas videos.
        const playingHover = cursorInside && !isOpen;
        // Always mount the PVP for video cards. This keeps the native <video>
        // element rendering at rest (paused at t=0) instead of falling back
        // to the JPEG poster, which goes through a different color path and
        // reads lighter than the native video rendering.

        const sized = getOpenMediaSize(headerMedia.aspect, windowW, windowH);
        const editorImgW = sized.width;
        const editorImgH = sized.height;
        const editorImgX = (windowW - editorImgW) / 2;
        const editorImgY = 100;

        const openRect = {
          left: editorImgX,
          top: editorImgY,
          width: editorImgW,
          height: editorImgH,
          borderRadius: 8,
        };
        const portalToBody = isShadowInstance || t > 0 || isClosing;
        const canvasRect = portalToBody
          ? {
              left: cardScreenLeft + groupDragDelta.dx * scale,
              top: cardScreenTop + groupDragDelta.dy * scale,
              width: cardW * scale,
              height: cardH * scale,
              borderRadius: cardRadius * scale,
            }
          : {
              // Honor the gsap-driven override so PVP follows the card
              // during reorder/undo animations (otherwise PVP stays at
              // note.positionX while the card slides → visible duplicate).
              left: posX - cardW / 2 + groupDragDelta.dx,
              top: posY - cardH / 2 + groupDragDelta.dy,
              width: cardW,
              height: cardH,
              borderRadius: cardRadius,
            };

        // Play while actively engaged OR animating (hover, opening/open,
        // resizing, closing). Keeping it playing through the close animation
        // avoids a play()-triggered compositor flash at t=0 when the close
        // finalizes. At canvas rest, the video is paused at currentTime=0.
        // isShadowInstance keeps playing=true during the first render after tap
        // (before t>0), so the cursorInside reset that happens on shadow mount
        // doesn't trigger a pause()+seek(0) mid-playback — which was the cause
        // of the visible saccade at open start.
        // Always pause while a card is being moved (this card directly via
        // isDragging, or as a follower in a group drag via isFollowing).
        const beingMoved = isDragging || isFollowing;
        const playing = !beingMoved && !!(playingHover || isShadowInstance || t > 0 || isResizing || isClosing || isSelected);
        const unlocked = editing;
        const pointerEvents = editing ? "auto" : "none";

        return (
          <PersistentVideoPlayer
            blockId={headerMedia.blockId}
            videoBlob={headerMedia.videoBlob}
            posterDataUrl={headerMedia.posterDataUrl}
            canvasRect={canvasRect}
            openRect={openRect}
            openProgress={t}
            editorScrollY={0}
            playing={playing}
            unlocked={unlocked}
            // Canvas-rest: match this note's zOrder so the PVP competes
            // with cards on equal footing (a dragged card with bumped
            // zOrder visually pulls above other cards' PVPs). When
            // animating to/from open (portalToBody), lift to the editor
            // controls layer so the video sits above the body backdrop.
            zIndex={portalToBody ? "var(--z-editor-controls)" : note.zOrder}
            portalToBody={portalToBody}
            // No animateLeftTop: card teleports too (CSS transition on the
            // composed transform was glitchy), so PVP must match — otherwise
            // PVP slides while card teleports → visible duplicate during
            // reorder/undo.
            animateLeftTop={false}
            isSelected={isSelected && openProgress < 0.1}
            pointerEvents={pointerEvents}
            rotationDeg={(isDragging || isFollowing) ? rotation : 0}
            isHovered={isHovered && !isSelected && !suppressScale && !isResizing}
            transformTransition={t === 0 && !isDragging && !isFollowing && !isResizing}
            isDeleting={isDeleting}
            isPopping={!!isPopping}
            showPoster={false}
          >
            {cornerOverlay}
          </PersistentVideoPlayer>
        );
      })()}
    </>
  );
}

// Custom propsAreEqual: shallow compare every prop EXCEPT `children`. The
// caller passes a fresh JSX element for `children` on every parent render
// (e.g. <NotePreview blocks={note.blocks} />) so naive React.memo always
// rebuilds, defeating its purpose. Since the rendered children content is a
// pure function of `note.blocks` (already covered by the `note` prop's
// shallow compare), skipping children's identity check is safe and lets
// memo hold for unrelated parent re-renders (pan, zoom, hover).
function notePropsEqual(prev: Props, next: Props): boolean {
  const keys = new Set<keyof Props>([...Object.keys(prev), ...Object.keys(next)] as Array<keyof Props>);
  for (const k of keys) {
    if (k === "children") continue;
    if (!Object.is(prev[k], next[k])) return false;
  }
  return true;
}

export default React.memo(NoteCard, notePropsEqual);
