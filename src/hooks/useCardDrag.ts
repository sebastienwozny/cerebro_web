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
  onShiftTap: () => void;
  onDragStart: (noteId: string) => void;
  onDragMove: (noteId: string, x: number, y: number) => void;
  onDragEnd: (noteId: string) => void;
  onDragRotation?: (rotation: number) => void;
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

  const { dragRotation, applyDragVelocity, releaseSpring } = useDragRotation(opts.onDragRotation);

  // Smoothed position via lerp
  const targetPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const smoothPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const smoothRaf = useRef<number>(0);
  const LERP_FACTOR = 0.35;

  const tickSmooth = useCallback(() => {
    const { noteId, onDragMove } = optsRef.current;
    const sx = smoothPos.current.x + (targetPos.current.x - smoothPos.current.x) * LERP_FACTOR;
    const sy = smoothPos.current.y + (targetPos.current.y - smoothPos.current.y) * LERP_FACTOR;
    smoothPos.current = { x: sx, y: sy };
    onDragMove(noteId, sx, sy);
    if (Math.abs(targetPos.current.x - sx) > 0.1 || Math.abs(targetPos.current.y - sy) > 0.1) {
      smoothRaf.current = requestAnimationFrame(tickSmooth);
    } else {
      smoothPos.current = { x: targetPos.current.x, y: targetPos.current.y };
      onDragMove(noteId, targetPos.current.x, targetPos.current.y);
      smoothRaf.current = 0;
    }
  }, []);

  // Window-level listeners for move/up — survives DOM reorders from bringToFront
  useEffect(() => {
    if (grabCount === 0) return;

    const onMove = (e: PointerEvent) => {
      if (!dragStart.current) return;
      const { scale, noteId, onDragStart } = optsRef.current;
      const dx = (e.clientX - dragStart.current.px) / scale;
      const dy = (e.clientY - dragStart.current.py) / scale;
      if (!isDraggingRef.current && Math.abs(dx) + Math.abs(dy) > 4 / scale) {
        isDraggingRef.current = true;
        setIsDragging(true);
        onDragStart(noteId);
        lastMoveRef.current = { x: e.clientX, time: performance.now() };
        smoothPos.current = { x: dragStart.current.noteX, y: dragStart.current.noteY };
      }
      if (isDraggingRef.current) {
        const tx = dragStart.current.noteX + dx;
        const ty = dragStart.current.noteY + dy;
        targetPos.current = { x: tx, y: ty };
        if (!smoothRaf.current) {
          smoothRaf.current = requestAnimationFrame(tickSmooth);
        }
        const now = performance.now();
        const dt = Math.max(now - lastMoveRef.current.time, 1);
        const vx = (e.clientX - lastMoveRef.current.x) / dt;
        applyDragVelocity(vx * 1000);
        lastMoveRef.current = { x: e.clientX, time: now };
      }
    };

    const onUp = (e: PointerEvent) => {
      if (!dragStart.current) return;
      const { noteId, onTap, onShiftTap, onDragEnd, onDragMove } = optsRef.current;
      if (smoothRaf.current) {
        cancelAnimationFrame(smoothRaf.current);
        smoothRaf.current = 0;
      }
      const dx = Math.abs(e.clientX - dragStart.current.px);
      const dy = Math.abs(e.clientY - dragStart.current.py);
      if (dx + dy < 4) {
        if (e.shiftKey) onShiftTap();
        else onTap();
      } else {
        // Snap to final target position before ending
        onDragMove(noteId, targetPos.current.x, targetPos.current.y);
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
      if (smoothRaf.current) {
        cancelAnimationFrame(smoothRaf.current);
        smoothRaf.current = 0;
      }
    };
  }, [grabCount, applyDragVelocity, releaseSpring, tickSmooth]);

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
