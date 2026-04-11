import { useCallback, useRef, useState } from "react";

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
  const [transform, setTransform] = useState<CanvasTransform>(loadSaved);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const scheduleSave = useCallback((t: CanvasTransform) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
    }, 300);
  }, []);

  const pan = useCallback(
    (dx: number, dy: number) => {
      setTransform((t) => {
        const next = { ...t, offsetX: t.offsetX + dx, offsetY: t.offsetY + dy };
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave]
  );

  const zoom = useCallback(
    (delta: number, cx: number, cy: number, windowW: number, windowH: number) => {
      setTransform((t) => {
        const factor = Math.pow(0.988, delta);
        const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, t.scale * factor));
        // Cursor position relative to canvas center
        const cursorFromCenterX = cx - windowW / 2;
        const cursorFromCenterY = cy - windowH / 2;
        // Zoom towards cursor: adjust offset so the point under the cursor stays fixed
        const ratio = newScale / t.scale;
        const newOffsetX = cursorFromCenterX - ratio * (cursorFromCenterX - t.offsetX);
        const newOffsetY = cursorFromCenterY - ratio * (cursorFromCenterY - t.offsetY);
        const next = { offsetX: newOffsetX, offsetY: newOffsetY, scale: newScale };
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave]
  );

  return { transform, pan, zoom, setTransform };
}
