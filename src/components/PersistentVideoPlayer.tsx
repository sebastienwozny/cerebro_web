import { memo, useEffect, useRef } from "react";
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
  transformTransition = false, showPoster = false,
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
  const x = lerp(canvasRect.left, openRect.left, t);
  // Editor-scroll offset only applies at t=1 (fully open); during the
  // opening animation the openRect is the landing target in viewport coords.
  const y = lerp(canvasRect.top, openRect.top - editorScrollY * t, t);
  const width = lerp(canvasRect.width, openRect.width, t);
  const height = lerp(canvasRect.height, openRect.height, t);
  const radius = lerp(canvasRect.borderRadius, openRect.borderRadius, t);
  const rot = rotationDeg * (1 - t);
  const isDragMode = Math.abs(rot) > 0.001;
  // Rotation goes on the OUTER layer (alongside translate3d). Chrome's video
  // compositor picks its color-managed "dark" path only when the direct
  // ancestor layer of the <video> has a stable scale-only transform — adding
  // a rotate there pushes it onto the "light" path. Keeping rotation up on
  // the outer layer preserves the dark rendering during drag.
  const outerTransform = `translate3d(${x}px, ${y}px, 0)${isDragMode ? ` rotate(${rot}deg)` : ""}`;
  const outerOrigin = isDragMode ? "top center" : "center";
  // Inner layer: always carries a non-identity scale so it stays promoted to
  // its own compositor layer. scale(1.02) on hover, scale(1) otherwise — both
  // keep the layer composited and on the same color path, so switching
  // hover/non-hover doesn't cause a brightness shift.
  const innerScale = isHovered && t === 0 ? 1.02 : 1;

  return createPortal(
    // Outer div: translates (and rotates during drag). Follows canvas pan
    // instantly (no CSS transition) so the portal stays locked to the card.
    <div
      onWheel={onWheel}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        transform: outerTransform,
        transformOrigin: outerOrigin,
        willChange: "transform",
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
          transform: `translateZ(0) scale(${innerScale})`,
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
      </div>
    </div>,
    document.body,
  );
}

export default memo(PersistentVideoPlayerImpl);
