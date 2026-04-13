import { useEffect, useRef } from "react";
import { PAN_MULTIPLIER } from "../constants";

export function useWheelNavigation(
  containerRef: React.RefObject<HTMLDivElement | null>,
  canvasLocked: boolean,
  windowW: number,
  windowH: number,
  pan: (dx: number, dy: number) => void,
  zoom: (delta: number, cx: number, cy: number, windowW: number, windowH: number) => void,
) {
  const lastGestureScale = useRef(1);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || canvasLocked) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const maxDelta = 10;
        const clampedDelta = Math.max(-maxDelta, Math.min(maxDelta, e.deltaY));
        zoom(clampedDelta, e.clientX, e.clientY, windowW, windowH);
      } else {
        pan(-e.deltaX * PAN_MULTIPLIER, -e.deltaY * PAN_MULTIPLIER);
      }
    };

    // Safari/WebKit gesture events — more reliable for trackpad pinch
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      lastGestureScale.current = (e as GestureEvent).scale;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const ge = e as GestureEvent;
      const delta = (lastGestureScale.current - ge.scale) * 100;
      lastGestureScale.current = ge.scale;
      zoom(delta, ge.clientX, ge.clientY, windowW, windowH);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGestureStart, { passive: false });
    el.addEventListener("gesturechange", onGestureChange, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
    };
  }, [pan, zoom, canvasLocked, windowW, windowH, containerRef]);
}

interface GestureEvent extends UIEvent {
  scale: number;
  clientX: number;
  clientY: number;
}
