import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Play, Pause, Volume2, VolumeX } from "lucide-react";
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
  /** Unmute the video (only in the open state). */
  unlocked: boolean;
  /** z-index (must sit above both the canvas card and the editor overlay). */
  zIndex: string | number;
  /** Pass-through pointer-events (canvas drag/hover vs open-card interaction). */
  pointerEvents: "auto" | "none";
  /** Card tilt (degrees) during drag. Fades out as the card opens. */
  rotationDeg?: number;
  /** Mirror the card's delete animation (scale to 0). */
  isDeleting?: boolean;
  /** Mirror the card's create-pop animation (scale 0.5 → 1). Used on undo
   *  of a delete and on initial card creation. */
  isPopping?: boolean;
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
   *  applies a 0.35s transform transition so it tracks the card smoothly. */
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
 *
 * ────────────────────────────────────────────────────────────────────────────
 *   CHROME HARDWARE-OVERLAY WORKAROUND — REVISIT IF CHROMIUM 40813064 LANDS
 * ────────────────────────────────────────────────────────────────────────────
 * The displayed video is rendered to a per-instance <canvas> element via
 * requestAnimationFrame + drawImage from a hidden source <video>. This is a
 * workaround for a known Chromium compositor bug where two videos with
 * `border-radius` displayed simultaneously see THROUGH each other (the
 * playing video's overlay plane has alpha pixels that reveal whatever is
 * compositionally below, including other canvas-rest videos), with no
 * reliable CSS fix:
 *   - Chromium issue: https://issues.chromium.org/issues/40813064
 *   - Firefox equivalent (already fixed): https://bugzilla.mozilla.org/show_bug.cgi?id=1869994
 *
 * If/when Chromium 40813064 ships a fix, this entire indirection can be
 * removed and we can go back to a single visible <video> per PVP:
 *   1. Delete `getVideoHost`, `videoHostEl`, and the offscreen-host setup.
 *   2. Drop the canvas rAF loop (`useEffect` at "Continuously copy …").
 *   3. Restore the previous useLayoutEffect that appended the cached
 *      <video> into innerRef and removed the <canvas> placeholder.
 *   4. Re-style the cached <video> to fill its parent (the prior CSS:
 *      "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block").
 * The `colorSpace: "display-p3"` on the canvas context is what currently
 * keeps the wide-gamut macOS color rendering matching the native overlay
 * path; reverting to direct <video> recovers it for free.
 */
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

// Module-level cache: one <video> element per blockId, survives NoteCard
// unmount/remount cycles (e.g. viewport culling during canvas pan). Without
// this, panning away and back creates a fresh element with no buffered data —
// the next play() call hits a blank frame and produces the visible saccade.
const videoElementCache = new Map<string, HTMLVideoElement>();

// Tracks which blockIds have had their audio pipeline initialized. Once
// pre-warmed we never call v.muted=true again — the expensive Chrome audio
// subsystem init is paid once at tap time (start of open animation) instead
// of at animation end when the stall is perceptible.
const audioPrewarmed = new Set<string>();

// Hidden host for all source <video> elements. They drive decoding and audio
// but are never visually displayed — each PVP renders frames to its own
// <canvas> via drawImage. This bypasses Chrome's hardware overlay path
// (which causes see-through between videos with border-radius — a known
// compositor bug, see Firefox bug 1869994 / Chromium 40813064), and lets us
// render through a Display P3 canvas to preserve color management.
let videoHostEl: HTMLDivElement | null = null;
function getVideoHost(): HTMLDivElement {
  if (!videoHostEl) {
    videoHostEl = document.createElement("div");
    videoHostEl.setAttribute("data-pvp-video-host", "");
    // Inside the viewport (so Chrome doesn't throttle decoding for
    // off-screen elements) but invisible: opacity 0, pointer-events none,
    // and `clip-path: inset(100%)` to remove painted output without
    // collapsing the layout box. Critically, the host does NOT constrain
    // size — Chrome optimizes video decoding based on the element's
    // display size, so a 1×1 host caused frames to be decoded at
    // minimum resolution. Letting the videos lay out at intrinsic size
    // (clipped, but un-collapsed) keeps decode quality at source.
    videoHostEl.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;opacity:0;pointer-events:none;contain:strict";
    document.body.appendChild(videoHostEl);
  }
  return videoHostEl;
}

function getOrCreateVideoElement(blockId: string): HTMLVideoElement {
  let v = videoElementCache.get(blockId);
  if (!v) {
    v = document.createElement("video");
    v.autoplay = true;
    v.loop = true;
    v.playsInline = true;
    v.muted = true;
    v.preload = "auto";
    // No CSS width/height: video lays out at its intrinsic resolution so
    // Chrome's decoder produces full-quality frames. The host's
    // `contain: strict` ensures these natural-size videos don't overflow
    // and affect layout/scroll.
    v.style.cssText = "display:block";
    getVideoHost().appendChild(v);
    videoElementCache.set(blockId, v);
  }
  return v;
}

/**
 * Call this synchronously inside a tap/click handler before opening a video
 * card. Runs `v.muted=false` while Chrome is still processing the gesture,
 * so the audio pipeline init stall is absorbed into the event handler and
 * never lands on an animation frame.
 */
export function prewarmAudio(blockId: string) {
  if (audioPrewarmed.has(blockId)) return;
  const v = videoElementCache.get(blockId);
  if (!v) return;
  audioPrewarmed.add(blockId);
  v.volume = 0.001;
  v.muted = false;
}

function PersistentVideoPlayerImpl({
  blockId, videoBlob, posterDataUrl,
  canvasRect, openRect, openProgress,
  playing, unlocked, zIndex, pointerEvents, rotationDeg = 0, isHovered = false,
  transformTransition = false, showPoster = false, portalToBody = false,
  animateLeftTop = false, isSelected = false, isDeleting = false, isPopping = false, children,
}: Props) {
  // Stable video element from the module-level cache — survives both React
  // re-renders and NoteCard unmount/remount (viewport culling on pan). The
  // element lives in a hidden host div; its frames are drawn to a per-PVP
  // <canvas> below.
  const videoRef = useRef<HTMLVideoElement>(getOrCreateVideoElement(blockId));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const outerRef = useRef<HTMLDivElement>(null);
  const drawRafRef = useRef(0);
  const objectUrl = getVideoUrl(blockId, videoBlob);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) {
      v.play().catch(() => {});
    } else {
      v.pause();
      try { v.currentTime = 0; } catch { /* pre-metadata — browser will clamp */ }
    }
  }, [playing]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (audioPrewarmed.has(blockId)) {
      // Pipeline already initialized by prewarmAudio() at tap time —
      // just adjust volume. Never touch muted again.
      v.volume = unlocked ? 1 : 0.001;
    } else {
      // Not yet pre-warmed (first-ever open, or prewarmAudio not called).
      v.muted = !unlocked;
      if (unlocked) v.volume = 1;
    }
  }, [unlocked, blockId]);

  // Set src whenever the objectUrl changes (stable for the same blob, but runs
  // on first render too since the element was created without a src attribute).
  useLayoutEffect(() => {
    const v = videoRef.current;
    if (v && v.src !== objectUrl) v.src = objectUrl;
  }, [objectUrl]);

  // Continuously copy the source <video>'s current frame to this PVP's
  // <canvas>. The canvas uses the Display P3 color space so wide-gamut
  // macOS displays render the video frames with the same color management
  // as Chrome's native overlay path — without putting the video itself on
  // overlay (which would cause see-through between videos with rounded
  // corners). The canvas element can change underneath us when the portal
  // target switches (canvas-rest → opening animation): React unmounts the
  // old canvas and mounts a new one. The loop reads `canvasRef.current`
  // every frame so it always targets the current element, and re-acquires
  // the 2D context whenever the canvas instance changes.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let stopped = false;
    let lastCanvas: HTMLCanvasElement | null = null;
    let ctx: CanvasRenderingContext2D | null = null;

    const draw = () => {
      if (stopped) return;
      const canvas = canvasRef.current;
      if (canvas !== lastCanvas) {
        lastCanvas = canvas;
        ctx = canvas
          ? (canvas.getContext("2d", { colorSpace: "display-p3" }) as CanvasRenderingContext2D | null)
          : null;
        // Hint the browser to use high-quality resampling when CSS scales
        // the canvas pixel buffer to its display size.
        if (ctx) ctx.imageSmoothingQuality = "high";
      }
      if (canvas && ctx && video.readyState >= 2 && video.videoWidth > 0) {
        if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
        if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      }
      drawRafRef.current = requestAnimationFrame(draw);
    };
    drawRafRef.current = requestAnimationFrame(draw);

    return () => {
      stopped = true;
      cancelAnimationFrame(drawRafRef.current);
    };
  }, []);

  // Sync showPoster → canvas visibility so the underlying poster <img> shows
  // through during the close hand-off (avoids a jump from last-frame to
  // first-frame on the canvas-card poster).
  useLayoutEffect(() => {
    const c = canvasRef.current;
    if (c) c.style.display = showPoster ? "none" : "block";
  }, [showPoster]);

  const [localSelected, setLocalSelected] = useState(false);
  useEffect(() => {
    if (!unlocked) { setLocalSelected(false); return; }
    const onDocClick = (e: MouseEvent) => {
      if (!outerRef.current?.contains(e.target as Node)) setLocalSelected(false);
    };
    document.addEventListener("click", onDocClick, true);
    return () => document.removeEventListener("click", onDocClick, true);
  }, [unlocked]);

  useEffect(() => {
    if (!localSelected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent("pvp-header-delete"));
        setLocalSelected(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [localSelected]);

  const hoverFillRef = useRef<HTMLDivElement>(null);
  const progressFillRef = useRef<HTMLDivElement>(null);
  const seekBarRef = useRef<HTMLDivElement>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [userMuted, setUserMuted] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [controlsVisible, setControlsVisible] = useState(true);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setControlsVisible(false), 2500);
  }, []);

  useEffect(() => {
    if (!unlocked) { clearTimeout(hideTimerRef.current); setControlsVisible(true); return; }
    hideTimerRef.current = setTimeout(() => setControlsVisible(false), 2500);
    return () => clearTimeout(hideTimerRef.current);
  }, [unlocked]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let rafId = 0;
    const tick = () => {
      rafId = requestAnimationFrame(tick);
      const ratio = v.duration > 0 ? v.currentTime / v.duration : 0;
      if (hoverFillRef.current) hoverFillRef.current.style.transform = `scaleX(${ratio})`;
      if (progressFillRef.current) progressFillRef.current.style.transform = `scaleX(${ratio})`;
    };
    rafId = requestAnimationFrame(tick);
    const onPlay = () => setIsPaused(false);
    const onPause = () => setIsPaused(true);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    return () => {
      cancelAnimationFrame(rafId);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
    };
  }, [portalToBody]);

  const togglePlayPause = (e: React.MouseEvent) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play(); else v.pause();
    showControls();
  };

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    const next = !userMuted;
    setUserMuted(next);
    v.volume = next ? 0.001 : 1;
    showControls();
  };

  const onSeekClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const v = videoRef.current;
    const bar = seekBarRef.current;
    if (!v || !bar || v.duration <= 0) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    v.currentTime = ratio * v.duration;
    showControls();
  };

  // Keep openRect current for the scroll handler without re-creating it.
  const openRectRef = useRef(openRect);
  openRectRef.current = openRect;

  // Tracks the current editor scroll offset. Kept in a ref (not state) so
  // updates never trigger a React re-render — the imperative DOM update below
  // is the only thing that needs to fire on scroll.
  const scrollOffsetRef = useRef(0);

  // Seed scroll offset once when the card opens (used for the absolute top calculation).
  useLayoutEffect(() => {
    if (!unlocked) { scrollOffsetRef.current = 0; return; }
    const overlay = document.querySelector("[data-editor-overlay]") as HTMLElement | null;
    scrollOffsetRef.current = overlay?.scrollTop ?? 0;
  }, [unlocked]);

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

  // When fully open (unlocked), the portal target switches to [data-editor-overlay]
  // so position:absolute tracks scroll natively — no JS, no lag.
  const portalTarget: Element = (() => {
    if (!portalToBody) return document.getElementById("pvp-portal-root") ?? document.body;
    if (unlocked) return document.querySelector("[data-editor-overlay]") ?? document.body;
    return document.body;
  })();

  let outerPositionStyle: React.CSSProperties;
  if (portalToBody) {
    if (unlocked) {
      // Fully open: absolute inside the scroll container. top/left are in
      // document-space (viewport + scrollTop), so the element scrolls with
      // the content natively with zero JS involvement.
      outerPositionStyle = {
        position: "absolute",
        top: openRect.top + scrollOffsetRef.current,
        left: openRect.left,
        willChange: "transform",
        transform: "translateZ(0)",
      };
    } else {
      const x = lerp(canvasRect.left, openRect.left, t);
      const y = lerp(canvasRect.top, openRect.top, t);
      const rot = rotationDeg * (1 - t);
      const isDragMode = Math.abs(rot) > 0.001;
      outerPositionStyle = {
        position: "fixed",
        top: 0,
        left: 0,
        transform: `translate3d(${x}px, ${y}px, 0)${isDragMode ? ` rotate(${rot}deg)` : ""}`,
        transformOrigin: isDragMode ? "top center" : "center",
        willChange: "transform",
        transition: "none",
      };
    }
  } else {
    // Rest / canvas-space mode. The canvas layer no longer applies a transform
    // (would create a stacking trap) — instead it exposes pan/zoom as
    // --pan-x / --pan-y / --zoom CSS variables that we compose into our own
    // transform here. transform-origin top-left so scale(--zoom) stretches
    // positions away from the canvas origin rather than the PVP's center.
    outerPositionStyle = {
      position: "absolute",
      left: 0,
      top: 0,
      transformOrigin: "top left",
      transform: `translate3d(var(--pan-x, 0px), var(--pan-y, 0px), 0) scale(var(--zoom, 1)) translate3d(${canvasRect.left}px, ${canvasRect.top}px, 0)`,
      transition: animateLeftTop
        ? "transform 0.35s cubic-bezier(0.25, 1, 0.5, 1)"
        : "none",
    };
  }
  // Inner layer uses a stable translateZ(0) only — no scale animation. Any
  // scale change on the direct parent of the <video> causes Chrome to
  // resample the texture, which reads as a brightness flash (notably at the
  // end of the close animation where scale transitions from 1 → 1.02).

  return createPortal(
    <div
      ref={outerRef}
      onWheel={onWheel}
      onClick={() => {
        if (!unlocked) return;
        setLocalSelected(true);
        // Let NoteEditor create a NodeSelection on the matching video node so
        // the media toolbar can trigger (PVP overlays the spacer VideoBlockView,
        // so its own onMouseDown never fires for header videos).
        window.dispatchEvent(new CustomEvent("pvp-select", { detail: { blockId } }));
        const v = videoRef.current;
        if (v) { if (v.paused) v.play(); else v.pause(); }
        showControls();
      }}
      style={{
        ...outerPositionStyle,
        width,
        height,
        zIndex,
        pointerEvents,
        borderRadius: radius,
      }}
    >
      {/* Inner div: hover scale, pop-in animation, and delete scale-down all
          live here. The outer's transform encodes canvas position via CSS-var
          composition with `transform-origin: top left` — applying scale(0) or
          a popIn keyframe on it would shrink toward the canvas origin (top-
          left), not the card's center. */}
      <div
        ref={innerRef}
        style={{
          width: "100%",
          height: "100%",
          // `scale(1.02)` on hover mirrors the NoteCard hover. The pre-applied
          // translateZ(0) keeps the layer GPU-stable so the scale is a pure
          // compositor op (no texture resample of the video). During drag,
          // rotate around `top center` to match the NoteCard's drag tilt
          // (the card "hangs" from where the pointer grabbed it).
          transform: isDeleting
            ? "translateZ(0) scale(0)"
            : Math.abs(rotationDeg) > 0.001
              ? `translateZ(0) rotate(${rotationDeg}deg)`
              : isHovered ? "translateZ(0) scale(1.02)" : "translateZ(0)",
          transformOrigin: Math.abs(rotationDeg) > 0.001 ? "top center" : "center",
          willChange: "transform",
          transition: isDeleting
            ? "transform 0.4s cubic-bezier(0.215, 0.61, 0.355, 1)"
            : transformTransition ? "transform 0.15s ease-out" : "none",
          borderRadius: radius,
          overflow: "hidden",
          position: "relative",
          animation: isPopping ? "popIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards" : undefined,
        }}
      >
        <img
          src={posterDataUrl}
          alt=""
          draggable={false}
          decoding="async"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            pointerEvents: "none",
          }}
        />
        {/* Canvas rendering of the source <video> (which lives offscreen).
            Using a canvas rather than displaying the <video> directly keeps
            this PVP off Chrome's hardware overlay plane — overlay videos
            with rounded corners cause see-through to other overlay videos
            (a known compositor bug). The canvas's `colorSpace: display-p3`
            preserves color management on wide-gamut macOS displays so the
            rendering matches what overlay would produce. */}
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            pointerEvents: "none",
          }}
        />
      </div>
      {/* Hover progress bar — canvas rest only */}
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
          opacity: playing && !unlocked && t === 0 ? 1 : 0,
          transition: "opacity 300ms ease-out",
        }}
      >
        <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.25)", borderRadius: 9999 }} />
        <div
          ref={hoverFillRef}
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
      {/* Custom controls overlay — open state only. Sibling of innerRef so it
          never touches the video GPU compositor layer. */}
      <div
        onMouseMove={showControls}
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: radius,
          overflow: "hidden",
          opacity: unlocked && controlsVisible ? 1 : 0,
          transition: "opacity 300ms ease-out",
          pointerEvents: unlocked ? "auto" : "none",
        }}
      >
        {/* Gradient scrim */}
        <div style={{
          position: "absolute",
          bottom: 0, left: 0, right: 0,
          height: 80,
          background: "linear-gradient(to top, rgba(0,0,0,0.55) 0%, transparent 100%)",
          pointerEvents: "none",
        }} />
        {/* Controls bar */}
        <div
          style={{
            position: "absolute",
            bottom: 0, left: 0, right: 0,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 12px",
          }}
        >
          {/* Play/Pause */}
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={togglePlayPause}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "#fff", display: "flex", alignItems: "center", flexShrink: 0 }}
          >
            {isPaused ? <Play size={18} fill="#fff" /> : <Pause size={18} fill="#fff" />}
          </button>
          {/* Seek bar */}
          <div
            ref={seekBarRef}
            onPointerDown={e => e.stopPropagation()}
            onClick={onSeekClick}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 9999,
              background: "rgba(255,255,255,0.3)",
              cursor: "pointer",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div
              ref={progressFillRef}
              style={{
                position: "absolute",
                inset: 0,
                background: "#fff",
                transformOrigin: "left",
                transform: "scaleX(0)",
              }}
            />
          </div>
          {/* Mute/Unmute */}
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={toggleMute}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "#fff", display: "flex", alignItems: "center", flexShrink: 0 }}
          >
            {userMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
        </div>
      </div>
      {/* Selection ring — sibling of inner div, outside the clip. Matches
          the same box-shadow style as images and non-header video blocks. */}
      <div
        style={{
          position: "absolute",
          inset: -3,
          borderRadius: radius + 3,
          border: "3px solid var(--color-selection-border)",
          pointerEvents: "none",
          opacity: isSelected || localSelected ? 1 : 0,
          transition: "opacity 150ms ease-out",
        }}
      />
      {/* Outside the rounded clip: corner resize handles for video cards.
          Rendered by NoteCard, positioned absolute against this wrapper.
          Wrapper mirrors the inner div's delete scale so corners shrink
          in lockstep with the video on delete. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          transform: isDeleting ? "scale(0)" : "none",
          transformOrigin: "center",
          transition: isDeleting
            ? "transform 0.4s cubic-bezier(0.215, 0.61, 0.355, 1)"
            : "none",
        }}
      >
        {children}
      </div>
    </div>,
    portalTarget,
  );
}

export default memo(PersistentVideoPlayerImpl);
