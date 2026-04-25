import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Note } from "../store/db";
import { useCardDrag } from "../hooks/useCardDrag";
import { useCardHover } from "../hooks/useCardHover";
import { useCardResize } from "../hooks/useCardResize";
import { useImageBrightness } from "../hooks/useImageBrightness";
import { CARD_CONTENT_W } from "../constants";
import { getCardSize, getHeaderMedia } from "../lib/cardDimensions";
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
  isOpen, isSelected, isDeleting, isPopping, isAnimating, openProgress, isClosing, closingScrollOffset, hoverSuppressed, spaceHeld, groupDragDelta, groupDragRotation,
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
  const cardRadius = Math.max(Math.min(cardW, cardH) * 0.10, 80);
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

  // Resize corners — same JSX rendered either inside the card (image cards)
  // or inside the PVP overlay (video cards, since the PVP covers the card).
  const cornerOverlay = isImageCard && openProgress === 0 && !isDragging ? (() => {
    const showCorners = isPointerOver && !hoverSuppressed && !isSelected;
    const cornerSize = Math.max(Math.round(Math.min(cardW, cardH) * 0.10), 70);
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
          // Position is encoded in this div's transform (via CSS-var pan/zoom
          // composition + visualLeft/Top). Animate transform during undo so
          // the card slides to its restored position in lockstep with its
          // PVP (which has its own matching transition). Without this, the
          // card teleports while the PVP slides — looks like a duplicate.
          transition: isAnimating && t === 0 && !isDragging && !isFollowing
            ? "transform 0.35s cubic-bezier(0.25, 1, 0.5, 1)"
            : undefined,
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
                // up feels like "lifting" out of the hover state. Video
                // cards still skip rotation entirely (PVP isn't rotation-
                // synced, so the card frame would rotate around a still
                // video).
                ? headerMedia?.type === "video"
                  ? "none"
                  : `rotate(${rotation}deg)`
                : isFollowing
                  ? headerMedia?.type === "video"
                    ? "none"
                    : `rotate(${rotation}deg)`
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

          {/* Editor content (card mode — clipped). Image cards: only during close. */}
          {!editing && (!isImageCard || (isClosing && t > 0)) && (
            <div
              className="absolute inset-0 flex justify-center pointer-events-none pt-30"
              style={{
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

        {/* Resize handles — image cards render them here (inside the card).
            Video cards render them via PVP so they sit above the video. */}
        {!isVideoCard && cornerOverlay}
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
          className="fixed inset-0 overflow-y-auto flex justify-center z-(--z-editor-overlay) pt-30 pb-10 px-5"
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

      {/* Hero image for image-card open/close transition — portal so it's not
          clipped. Video cards use PersistentVideoPlayer below instead. */}
      {!isShadowInstance && isMediaCard && headerMedia?.type === "image" && t > 0 && !editing && headerDataUrl && (() => {
        const editorImgW = CARD_CONTENT_W;
        const editorImgH = CARD_CONTENT_W * headerMedia.aspect;
        const editorImgX = (windowW - editorImgW) / 2;
        const editorImgY = 120;

        const targetX = isClosing && closingImgRect.current ? closingImgRect.current.x : editorImgX;
        const targetY = isClosing && closingImgRect.current ? closingImgRect.current.y : editorImgY;
        const targetW = isClosing && closingImgRect.current ? closingImgRect.current.w : editorImgW;
        const targetH = isClosing && closingImgRect.current ? closingImgRect.current.h : editorImgH;

        return createPortal(
          <img
            src={headerDataUrl}
            alt=""
            style={{
              position: "fixed",
              left: lerp(cardScreenLeft, targetX, t),
              top: lerp(cardScreenTop, targetY, t),
              width: lerp(cardW * scale, targetW, t),
              height: lerp(cardH * scale, targetH, t),
              objectFit: "cover",
              zIndex: "var(--z-editor-controls)",
              pointerEvents: "none",
              borderRadius: lerp(cardRadius * scale, 6, t),
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

        const editorImgW = CARD_CONTENT_W;
        const editorImgH = CARD_CONTENT_W * headerMedia.aspect;
        const editorImgX = (windowW - editorImgW) / 2;
        const editorImgY = 120;

        const openRect = {
          left: editorImgX,
          top: editorImgY,
          width: editorImgW,
          height: editorImgH,
          borderRadius: 6,
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
              left: note.positionX - cardW / 2 + groupDragDelta.dx,
              top: note.positionY - cardH / 2 + groupDragDelta.dy,
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
        const playing = !!(playingHover || isShadowInstance || t > 0 || isResizing || isClosing || isSelected);
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
            animateLeftTop={!!isAnimating && !isDragging && !isFollowing && t === 0}
            isSelected={isSelected && openProgress < 0.1}
            pointerEvents={pointerEvents}
            rotationDeg={0}
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
