import { useCallback, useRef } from "react";

export interface CanvasTransform {
  offsetX: number;
  offsetY: number;
  scale: number;
}

const STORAGE_KEY = "cerebro.canvas";
const MIN_SCALE = 0.1;
const MAX_SCALE = 3;

function loadSaved(): CanvasTransform {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { offsetX: 0, offsetY: 0, scale: 0.5 };
}

export function useCanvas() {
  // Mutable ref — updated on every pan/zoom without triggering React re-renders
  const transformRef = useRef<CanvasTransform>(loadSaved());
  // DOM ref for the canvas layer div — we write transforms directly to it
  const layerRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const scheduleSave = useCallback(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(transformRef.current));
    }, 300);
  }, []);

  // Apply transform directly to DOM — no React re-render
  const applyTransform = useCallback(() => {
    const el = layerRef.current;
    if (!el) return;
    const { offsetX, offsetY, scale } = transformRef.current;
    el.style.transform = `translate3d(${offsetX}px, ${offsetY}px, 0) scale(${scale})`;
  }, []);

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
      const factor = Math.pow(0.988, delta);
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

  // Read current transform (for open animation, double-click positioning, etc.)
  const getTransform = useCallback(() => transformRef.current, []);

  return { transformRef, layerRef, pan, zoom, getTransform, applyTransform };
}
