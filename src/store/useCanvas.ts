import { useCallback, useRef, useState, startTransition } from "react";
import { MIN_SCALE, MAX_SCALE, ZOOM_SENSITIVITY } from "../constants";

export interface CanvasTransform {
  offsetX: number;
  offsetY: number;
  scale: number;
}

const STORAGE_KEY = "cerebro.canvas";

function loadSaved(): CanvasTransform {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // corrupted storage — fall through to defaults
  }
  return { offsetX: 0, offsetY: 0, scale: 0.5 };
}

export function useCanvas() {
  const transformRef = useRef<CanvasTransform>(loadSaved());
  const layerRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [transformVersion, setTransformVersion] = useState(0);
  const scheduleSave = useCallback(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(transformRef.current));
    }, 300);
  }, []);

  const rafRef = useRef(0);
  const scheduleRerender = useCallback(() => {
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        // Mark the pan/zoom-driven re-render as a transition so React 18
        // can interrupt it for higher-priority work (text input, hover,
        // selection updates). Keeps urgent UI snappy under heavy load.
        startTransition(() => setTransformVersion(v => v + 1));
      });
    }
  }, []);

  const applyTransform = useCallback(() => {
    const el = layerRef.current;
    if (!el) return;
    const { offsetX, offsetY, scale } = transformRef.current;
    // Expose pan/zoom as CSS vars instead of applying a transform on the
    // canvas layer itself. A `transform` on the parent would create a
    // stacking context that traps every descendant's z-index — preventing
    // dragged cards from lifting above e.g. video PVPs. By keeping the
    // canvas layer transform-free, cards and PVPs share the body stacking
    // context and their `note.zOrder` z-indices compete naturally. Each
    // card composes these CSS vars into its own transform to apply
    // pan/zoom to its position.
    el.style.setProperty("--pan-x", `${offsetX}px`);
    el.style.setProperty("--pan-y", `${offsetY}px`);
    el.style.setProperty("--zoom", `${scale}`);
    scheduleRerender();
  }, [scheduleRerender]);

  const pan = useCallback(
    (dx: number, dy: number) => {
      const t = transformRef.current;
      t.offsetX += dx;
      t.offsetY += dy;
      applyTransform();
      scheduleSave();
    },
    [applyTransform, scheduleSave]
  );

  const zoom = useCallback(
    (delta: number, cx: number, cy: number, windowW: number, windowH: number) => {
      const t = transformRef.current;
      const factor = Math.pow(ZOOM_SENSITIVITY, delta);
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, t.scale * factor));
      const cursorFromCenterX = cx - windowW / 2;
      const cursorFromCenterY = cy - windowH / 2;
      const ratio = newScale / t.scale;
      t.offsetX = cursorFromCenterX - ratio * (cursorFromCenterX - t.offsetX);
      t.offsetY = cursorFromCenterY - ratio * (cursorFromCenterY - t.offsetY);
      t.scale = newScale;
      applyTransform();
      scheduleSave();
    },
    [applyTransform, scheduleSave]
  );

  const getTransform = useCallback(() => transformRef.current, []);

  return { transformRef, transformVersion, layerRef, pan, zoom, getTransform, applyTransform };
}
