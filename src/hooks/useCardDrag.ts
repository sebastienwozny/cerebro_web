import { useCallback, useEffect, useRef, useState } from "react";
import { useDragRotation } from "./useDragRotation";

interface UseCardDragOptions {
  noteId: string;
  positionX: number;
  positionY: number;
  scale: number;
  isOpen: boolean;
  openProgress: number;
  onTap: () => void;
  onDragMove: (noteId: string, x: number, y: number) => void;
  onDragEnd: (noteId: string) => void;
  onBringToFront: (noteId: string) => void;
}

export function useCardDrag(opts: UseCardDragOptions) {
  const [isDragging, setIsDragging] = useState(false);
  // Incremented on pointerDown to trigger effect that attaches window listeners
  const [grabCount, setGrabCount] = useState(0);
  const dragStart = useRef<{ px: number; py: number; noteX: number; noteY: number } | null>(null);
  const lastMoveRef = useRef<{ x: number; time: number }>({ x: 0, time: 0 });
  const isDraggingRef = useRef(false);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const { dragRotation, applyDragVelocity, releaseSpring } = useDragRotation();

  // Window-level listeners for move/up — survives DOM reorders from bringToFront
  useEffect(() => {
    if (grabCount === 0) return;

    const onMove = (e: PointerEvent) => {
      if (!dragStart.current) return;
      const { scale, noteId, onDragMove } = optsRef.current;
      const dx = (e.clientX - dragStart.current.px) / scale;
      const dy = (e.clientY - dragStart.current.py) / scale;
      if (!isDraggingRef.current && Math.abs(dx) + Math.abs(dy) > 4 / scale) {
        isDraggingRef.current = true;
        setIsDragging(true);
        lastMoveRef.current = { x: e.clientX, time: performance.now() };
      }
      if (isDraggingRef.current) {
        onDragMove(noteId, dragStart.current.noteX + dx, dragStart.current.noteY + dy);
        const now = performance.now();
        const dt = Math.max(now - lastMoveRef.current.time, 1);
        const vx = (e.clientX - lastMoveRef.current.x) / dt;
        applyDragVelocity(vx * 1000);
        lastMoveRef.current = { x: e.clientX, time: now };
      }
    };

    const onUp = (e: PointerEvent) => {
      if (!dragStart.current) return;
      const { noteId, onTap, onDragEnd } = optsRef.current;
      const dx = Math.abs(e.clientX - dragStart.current.px);
      const dy = Math.abs(e.clientY - dragStart.current.py);
      if (dx + dy < 4) {
        onTap();
      } else {
        onDragEnd(noteId);
      }
      dragStart.current = null;
      isDraggingRef.current = false;
      setIsDragging(false);
      releaseSpring();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [grabCount, applyDragVelocity, releaseSpring]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const { isOpen, openProgress, positionX, positionY, noteId, onBringToFront } = optsRef.current;
      if (isOpen || openProgress > 0.1) return;
      if (e.button !== 0) return;
      dragStart.current = { px: e.clientX, py: e.clientY, noteX: positionX, noteY: positionY };
      setGrabCount(c => c + 1);
      onBringToFront(noteId);
    },
    []
  );

  return { isDragging, dragRotation, handlePointerDown };
}
