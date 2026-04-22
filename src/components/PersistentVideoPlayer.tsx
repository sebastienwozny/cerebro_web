import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { getVideoUrl } from "../lib/videoUrlCache";

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
  borderRadius: number;
}

interface Props {
  blockId: string;
  videoBlob: Blob;
  posterDataUrl: string;
  /** Canvas-card screen rect. Used at t=0 (hover) and as origin during open. */
  canvasRect: Rect;
  /** Editor-target screen rect. Used at t=1 (open) and as destination. */
  openRect: Rect;
  /** Animation progress: 0 = canvas hover, 1 = fully open. */
  openProgress: number;
  /** Scroll offset of the editor overlay (subtracted from openRect.top at t=1
   * so the video scrolls naturally with the note body). */
  editorScrollY: number;
  /** Whether the video should be actively playing. */
  playing: boolean;
  /** Unmute and show native controls (only in the open state). */
  unlocked: boolean;
  /** z-index (must sit above both the canvas card and the editor overlay). */
  zIndex: string | number;
  /** Pass-through pointer-events (canvas drag/hover vs open-card interaction). */
  pointerEvents: "auto" | "none";
  /** Card tilt (degrees) during drag. Fades out as the card opens. */
  rotationDeg?: number;
  /** Whether the card is being hovered at rest — applies a 1.02 scale to match the card. */
  isHovered?: boolean;
  /** True when the transform is stable frame-to-frame (no drag/resize/open-anim).
   *  Enables a 0.15s transform transition so the hover scale eases like the card. */
  transformTransition?: boolean;
  /** Hide the video element so the poster shows through. Used during close so
   *  the final canvas-card poster hand-off isn't a jump from last-frame to first. */
  showPoster?: boolean;
  /** When true, portal into document.body (above everything) and position via
   *  fixed+translate3d in screen space. Used for the card currently
   *  opening/open/closing so the video sits above the editor and lerps
   *  smoothly between canvas rect and open rect.
   *  When false, portal into #pvp-portal-root inside the canvas layer and
   *  position via absolute left/top in *canvas space*. The layer's transform
   *  handles pan/zoom so the PVP moves in lockstep with canvas cards with no
   *  per-frame React re-render. */
  portalToBody?: boolean;
  /** True when the card is running a post-drag / undo spring animation. PVP
   *  applies the same 0.35s left/top transition so it tracks the card in the
   *  rest/canvas-space mode. No-op when `portalToBody` is true. */
  animateLeftTop?: boolean;
  /** Draw the selection border over the video. The card's own selection
   *  border is inside the clipped card content, which on video cards is
   *  fully covered by the PVP above — so the PVP needs to render its own. */
  isSelected?: boolean;
  /** Extra nodes rendered above the video (outside the rounded clip), used
   *  for interactive overlays the card can't reach because the PVP covers
   *  it — notably the resize corner handles. */
  children?: ReactNode;
}

/**
 * One `<video>` element that persists across hover → open → close. Portal at
 * body level so React never re-parents it, so playback state never resets.
 *
 * Positioning uses `transform: translate(x, y)` rather than `left/top` — GPU-
 * accelerated so drag at canvas stays smooth. Size is interpolated normally.
 *
 * `muted` is set inline (default attribute) at initial render so the browser's
 * autoplay policy accepts the play() call; useEffect only flips it off when
 * `unlocked` becomes true in the open state.
 */
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

let pvpInstanceCounter = 0;

function PersistentVideoPlayerImpl({
  blockId, videoBlob, posterDataUrl,
  canvasRect, openRect, openProgress, editorScrollY,
  playing, unlocked, zIndex, pointerEvents, rotationDeg = 0, isHovered = false,
  transformTransition = false, showPoster = false, portalToBody = false,
  animateLeftTop = false, isSelected = false, children,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const objectUrl = getVideoUrl(blockId, videoBlob);
  const instanceIdRef = useRef<number>(0);
  if (instanceIdRef.current === 0) {
    pvpInstanceCounter += 1;
    instanceIdRef.current = pvpInstanceCounter;
  }
  const iid = instanceIdRef.current;

  // Mount / unmount tracking
  useEffect(() => {
    console.log("[PVP MOUNT]", { iid, blockId, initialPlaying: playing, showPoster });
    return () => {
      const v = videoRef.current;
      console.log("[PVP UNMOUNT]", { iid, blockId, currentTime: v?.currentTime, paused: v?.paused });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Attach native <video> event listeners so we can see what the element is
  // actually doing regardless of React state.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const log = (ev: string) => () => console.log(`[PVP video.${ev}]`, { iid, blockId, paused: v.paused, currentTime: v.currentTime, readyState: v.readyState });
    const handlers = {
      play: log("play"),
      pause: log("pause"),
      playing: log("playing"),
      ended: log("ended"),
      waiting: log("waiting"),
      loadedmetadata: log("loadedmetadata"),
      canplay: log("canplay"),
    };
    for (const [ev, h] of Object.entries(handlers)) v.addEventListener(ev, h);
    return () => {
      for (const [ev, h] of Object.entries(handlers)) v.removeEventListener(ev, h);
    };
  }, [blockId, iid]);

  useEffect(() => {
    const v = videoRef.current;
    const videoCount = document.querySelectorAll("video").length;
    console.log("[PVP] playing effect ENTER", { iid, blockId, playing, showPoster, videoExists: !!v, paused: v?.paused, currentTime: v?.currentTime, videoCountInDOM: videoCount });
    if (!v) return;
    if (playing) {
      v.play().then(() => {
        console.log("[PVP] play() resolved", { iid, blockId, paused: v.paused, currentTime: v.currentTime });
      }).catch((err) => {
        console.log("[PVP] play() rejected", { iid, blockId, err: err?.message });
      });
    } else {
      v.pause();
      // Seek to 0 so the next reveal (next hover or reopened card) starts on
      // the exact poster frame — fixes the brightness mismatch where the
      // video resumed at a middle frame different from the poster.
      try { v.currentTime = 0; } catch { /* pre-metadata — browser will clamp */ }
      console.log("[PVP] pause()+seek0", { iid, blockId, paused: v.paused, currentTime: v.currentTime });
      requestAnimationFrame(() => {
        console.log("[PVP] post-pause rAF check", { iid, blockId, paused: v.paused, currentTime: v.currentTime });
      });
    }
  }, [playing]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !unlocked;
    v.controls = unlocked;
  }, [unlocked]);

  const progressFillRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTimeUpdate = () => {
      const fill = progressFillRef.current;
      if (!fill || v.duration <= 0) return;
      fill.style.transform = `scaleX(${v.currentTime / v.duration})`;
    };
    v.addEventListener("timeupdate", onTimeUpdate);
    return () => v.removeEventListener("timeupdate", onTimeUpdate);
  }, []);

  // Wheel forwarding — during open (pointerEvents:"auto") the video element
  // catches wheel events that would otherwise scroll the editor overlay. We
  // find the scroll container and apply the deltaY manually.
  const onWheel = (e: React.WheelEvent) => {
    if (pointerEvents !== "auto") return;
    const overlay = document.querySelector("[data-editor-overlay]") as HTMLDivElement | null;
    if (!overlay) return;
    overlay.scrollTop += e.deltaY;
  };

  const t = Math.max(0, Math.min(1, openProgress));
  // In portalToBody mode canvasRect is in screen space, lerped with openRect
  // (also screen) via openProgress. In canvas-rest mode canvasRect is in
  // canvas space (t is always 0 in this mode, so the lerp is a no-op).
  const width = lerp(canvasRect.width, openRect.width, t);
  const height = lerp(canvasRect.height, openRect.height, t);
  const radius = lerp(canvasRect.borderRadius, openRect.borderRadius, t);

  let outerPositionStyle: React.CSSProperties;
  if (portalToBody) {
    const x = lerp(canvasRect.left, openRect.left, t);
    // Editor-scroll offset only applies at t=1 (fully open); during the
    // opening animation the openRect is the landing target in viewport coords.
    const y = lerp(canvasRect.top, openRect.top - editorScrollY * t, t);
    const rot = rotationDeg * (1 - t);
    const isDragMode = Math.abs(rot) > 0.001;
    // Rotation goes on the OUTER layer (alongside translate3d). Chrome's video
    // compositor picks its color-managed "dark" path only when the direct
    // ancestor layer of the <video> has a stable scale-only transform — adding
    // a rotate there pushes it onto the "light" path. Keeping rotation up on
    // the outer layer preserves the dark rendering during drag.
    outerPositionStyle = {
      position: "fixed",
      top: 0,
      left: 0,
      transform: `translate3d(${x}px, ${y}px, 0)${isDragMode ? ` rotate(${rot}deg)` : ""}`,
      transformOrigin: isDragMode ? "top center" : "center",
      willChange: "transform",
      // Explicitly cleared so a left/top transition carried over from rest
      // mode doesn't fire when `left`/`top` reset to 0 on mode switch.
      transition: "none",
    };
  } else {
    // Rest / canvas-space mode. Positioned via left/top inside pvp-portal-root
    // which lives in the scaled canvas layer, so pan/zoom are handled by the
    // layer's transform — no per-frame React work and no pan-lag between card
    // and PVP. Matches the card's post-drag/undo spring via `animateLeftTop`.
    outerPositionStyle = {
      position: "absolute",
      left: canvasRect.left,
      top: canvasRect.top,
      transition: animateLeftTop
        ? "left 0.35s cubic-bezier(0.25, 1, 0.5, 1), top 0.35s cubic-bezier(0.25, 1, 0.5, 1)"
        : "none",
    };
  }
  // Inner layer uses a stable translateZ(0) only — no scale animation. Any
  // scale change on the direct parent of the <video> causes Chrome to
  // resample the texture, which reads as a brightness flash (notably at the
  // end of the close animation where scale transitions from 1 → 1.02).

  return createPortal(
    <div
      onWheel={onWheel}
      style={{
        ...outerPositionStyle,
        width,
        height,
        zIndex,
        pointerEvents,
      }}
    >
      {/* Inner div: hover scale only, on its own stable GPU layer so the
          video compositor stays on the color-managed path across all states. */}
      <div
        style={{
          width: "100%",
          height: "100%",
          transform: "translateZ(0)",
          transformOrigin: "center",
          willChange: "transform",
          transition: transformTransition ? "transform 0.15s ease-out" : "none",
          borderRadius: radius,
          overflow: "hidden",
          position: "relative",
        }}
      >
        <img
          src={posterDataUrl}
          alt=""
          draggable={false}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            pointerEvents: "none",
          }}
        />
        {/* Video stays mounted so the ref remains live (and state like
            currentTime persists). During close we hide it with display:none
            and `playing=false` pauses it — the poster img behind is all the
            user sees. */}
        <video
          ref={videoRef}
          src={objectUrl}
          autoPlay
          loop
          playsInline
          muted
          preload="auto"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: showPoster ? "none" : "block",
          }}
        />
        {/* Selection border — rendered here (not on the card) because on
            video cards the PVP covers the card entirely, hiding the card's
            own border overlay. borderRadius matches the inner clip so the
            corners trace the same rounded shape as the card. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            border: "4px solid var(--color-selection-border)",
            borderRadius: radius,
            boxSizing: "border-box",
            opacity: isSelected ? 1 : 0,
            transition: "opacity 150ms ease-out",
          }}
        />
      </div>
      {/* Progress bar — sibling of the inner div so it lives on a separate
          layer and never perturbs the video's GPU compositor path. */}
      <div
        style={{
          position: "absolute",
          bottom: 15,
          left: "30%",
          right: "30%",
          height: 8,
          borderRadius: 9999,
          overflow: "hidden",
          pointerEvents: "none",
          opacity: playing && !unlocked ? 1 : 0,
          transition: "opacity 300ms ease-out",
        }}
      >
        {/* Track */}
        <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.25)", borderRadius: 9999 }} />
        {/* Fill */}
        <div
          ref={progressFillRef}
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(255,255,255,1)",
            transformOrigin: "left",
            transform: "scaleX(0)",
            transition: "transform 0.25s linear",
            borderRadius: 9999,
          }}
        />
      </div>
      {/* Outside the rounded clip: corner resize handles for video cards.
          Rendered by NoteCard, positioned absolute against the outer div. */}
      {children}
    </div>,
    portalToBody
      ? document.body
      : (document.getElementById("pvp-portal-root") ?? document.body),
  );
}

export default memo(PersistentVideoPlayerImpl);
