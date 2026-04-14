import React, { useEffect, useRef, useState } from "react";

interface Params {
  noteId: string;
  cardScale: number;
  positionX: number;
  positionY: number;
  baseW: number;
  baseH: number;
  canvasScale: number;
  resizingRef: React.MutableRefObject<boolean>;
  onResize?: (noteId: string, newScale: number, newPosX: number, newPosY: number) => void;
  onResizeEnd?: (noteId: string, oldScale: number, oldPosX: number, oldPosY: number) => void;
  onInteractionStart: () => void;
  onResizeRelease: () => void;
}

/**
 * Manages resize state and global pointer listeners for card resize handles.
 * Returns isResizing state and a factory for per-handle pointer-down props.
 */
export function useCardResize({
  noteId,
  cardScale,
  positionX,
  positionY,
  baseW,
  baseH,
  canvasScale,
  resizingRef,
  onResize,
  onResizeEnd,
  onInteractionStart,
  onResizeRelease,
}: Params) {
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartRef = useRef({ pointerX: 0, startScale: 1, startPosX: 0, startPosY: 0, dirX: 1, dirY: 0 });
  const resizeCaptureRef = useRef<Element | null>(null);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!resizingRef.current) return;
      const ref = resizeStartRef.current;
      const dx = (e.clientX - ref.pointerX) * ref.dirX;
      const newScale = Math.max(0.3, ref.startScale + dx / baseW / canvasScale);
      const deltaW = (newScale - ref.startScale) * baseW;
      const deltaH = (newScale - ref.startScale) * baseH;
      const newPosX = ref.startPosX + ref.dirX * deltaW / 2;
      const newPosY = ref.startPosY + ref.dirY * deltaH / 2;
      onResize?.(noteId, newScale, newPosX, newPosY);
    };

    const onUp = () => {
      if (resizingRef.current) {
        onResizeEnd?.(noteId, resizeStartRef.current.startScale, resizeStartRef.current.startPosX, resizeStartRef.current.startPosY);
      }
      resizingRef.current = false;
      setIsResizing(false);
      onResizeRelease();
      resizeCaptureRef.current = null;
    };

    const onBlur = () => { if (resizingRef.current) onUp(); };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  });

  const makeResizeHandlers = (dirX: 1 | -1, dirY: -1 | 0 | 1) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      (e.target as Element).setPointerCapture(e.pointerId);
      resizeCaptureRef.current = e.target as Element;
      resizingRef.current = true;
      setIsResizing(true);
      onInteractionStart();
      resizeStartRef.current = {
        pointerX: e.clientX,
        startScale: cardScale,
        startPosX: positionX,
        startPosY: positionY,
        dirX,
        dirY,
      };
    },
  });

  return { isResizing, makeResizeHandlers };
}
