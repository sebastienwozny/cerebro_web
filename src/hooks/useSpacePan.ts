import { useCallback, useEffect, useRef, useState } from "react";
import type { CanvasTransform } from "../store/useCanvas";

export function useSpacePan(
  canvasLocked: boolean,
  pan: (dx: number, dy: number) => void,
  getTransform: () => CanvasTransform,
) {
  const [spaceHeld, setSpaceHeld] = useState(false);
  const spacePanRef = useRef<{ startX: number; startY: number; offsetX: number; offsetY: number } | null>(null);

  useEffect(() => {
    if (canvasLocked) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        setSpaceHeld(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceHeld(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [canvasLocked]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!spaceHeld || canvasLocked) return;
      e.preventDefault();
      const t = getTransform();
      spacePanRef.current = { startX: e.clientX, startY: e.clientY, offsetX: t.offsetX, offsetY: t.offsetY };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [spaceHeld, canvasLocked, getTransform]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!spacePanRef.current) return;
      const t = getTransform();
      const dx = e.clientX - spacePanRef.current.startX;
      const dy = e.clientY - spacePanRef.current.startY;
      pan(dx - (t.offsetX - spacePanRef.current.offsetX), dy - (t.offsetY - spacePanRef.current.offsetY));
    },
    [pan, getTransform]
  );

  const handlePointerUp = useCallback(() => {
    spacePanRef.current = null;
  }, []);

  return { spaceHeld, handlePointerDown, handlePointerMove, handlePointerUp };
}
