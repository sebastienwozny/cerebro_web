import { useCallback, useRef, useState } from "react";
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
        setTransformVersion(v => v + 1);
      });
    }
  }, []);

  const applyTransform = useCallback(() => {
    const el = layerRef.current;
    if (!el) return;
    const { offsetX, offsetY, scale } = transformRef.current;
    const t = `translate3d(${offsetX}px, ${offsetY}px, 0) scale(${scale})`;
    el.style.transform = t;
    const pvpRoot = document.getElementById("pvp-portal-root");
    if (pvpRoot) pvpRoot.style.transform = t;
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
