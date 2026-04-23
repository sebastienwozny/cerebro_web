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
 */
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

let pvpInstanceCounter = 0;

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

function getOrCreateVideoElement(blockId: string): HTMLVideoElement {
  let v = videoElementCache.get(blockId);
  if (!v) {
    v = document.createElement("video");
    v.autoplay = true;
    v.loop = true;
    v.playsInline = true;
    v.muted = true;
    v.preload = "auto";
    v.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block";
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
  canvasRect, openRect, openProgress, editorScrollY,
  playing, unlocked, zIndex, pointerEvents, rotationDeg = 0, isHovered = false,
  transformTransition = false, showPoster = false, portalToBody = false,
  animateLeftTop = false, isSelected = false, children,
}: Props) {
  // Stable video element from the module-level cache — survives both React
  // re-renders and NoteCard unmount/remount (viewport culling on pan).
  const videoRef = useRef<HTMLVideoElement>(getOrCreateVideoElement(blockId));
  const innerRef = useRef<HTMLDivElement>(null);
  const outerRef = useRef<HTMLDivElement>(null);
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

  // Sync showPoster → display style directly so React never touches the element.
  useLayoutEffect(() => {
    const v = videoRef.current;
    if (v) v.style.display = showPoster ? "none" : "block";
  }, [showPoster]);

  // After every render, move the stable video element into the current inner div.
  // appendChild is a no-op if already the last child; if the portal container
  // just changed, this re-parents the element before the browser paints —
  // preserving playback state with no visible stutter.
  useLayoutEffect(() => {
    const inner = innerRef.current;
    const v = videoRef.current;
    if (!inner || !v) return;
    if (inner.lastChild !== v) inner.appendChild(v);
  });

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
      ref={outerRef}
      onWheel={onWheel}
      onClick={(e) => {
        if (!unlocked) return;
        setLocalSelected(true);
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
      {/* Inner div: hover scale only, on its own stable GPU layer so the
          video compositor stays on the color-managed path across all states.
          The <video> element is appended here imperatively by useLayoutEffect
          so it survives portal container changes without recreation. */}
      <div
        ref={innerRef}
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
        {/* <video> is injected imperatively via useLayoutEffect — see above */}
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
          Rendered by NoteCard, positioned absolute against the outer div. */}
      {children}
    </div>,
    portalToBody
      ? document.body
      : (document.getElementById("pvp-portal-root") ?? document.body),
  );
}

export default memo(PersistentVideoPlayerImpl);
