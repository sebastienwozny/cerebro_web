import { useEffect } from "react";
import { PAN_MULTIPLIER } from "../constants";

export function useWheelNavigation(
  containerRef: React.RefObject<HTMLDivElement | null>,
  canvasLocked: boolean,
  windowW: number,
  windowH: number,
  pan: (dx: number, dy: number) => void,
  zoom: (delta: number, cx: number, cy: number, windowW: number, windowH: number) => void,
) {
  useEffect(() => {
    const el = containerRef.current;
    if (!el || canvasLocked) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        zoom(e.deltaY, e.clientX, e.clientY, windowW, windowH);
      } else {
        pan(-e.deltaX * PAN_MULTIPLIER, -e.deltaY * PAN_MULTIPLIER);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [pan, zoom, canvasLocked, windowW, windowH, containerRef]);
}
