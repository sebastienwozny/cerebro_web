import { useCallback, useRef, useState } from "react";
import { DRAG_LERP_FACTOR } from "../constants";
import { useDragRotation } from "./useDragRotation";

interface UseCardDragOptions {
  noteId: string;
  positionX: number;
  positionY: number;
  scale: number;
  isOpen: boolean;
  openProgress: number;
  onTap: (noteId: string) => void;
  onShiftTap: (noteId: string) => void;
  onDragStart: (noteId: string) => void;
  onDragMove: (noteId: string, x: number, y: number) => void;
  onDragEnd: (noteId: string) => void;
  onDragRotation?: (rotation: number) => void;
  onDragDuplicate?: (noteId: string) => void;
  onBringToFront: (noteId: string) => void;
}

export function useCardDrag(opts: UseCardDragOptions) {
  const [isDragging, setIsDragging] = useState(false);
  // Press visual armed once we're confident the user intends to drag (any
  // movement, or a 100ms hold without moving). Plain quick taps never set
  // it, so the card doesn't scale-down on its way to opening — only when
  // a drag is actually starting.
  const [isPressed, setIsPressed] = useState(false);
  const pressTimerRef = useRef<number>(0);
  const dragStart = useRef<{ px: number; py: number; noteX: number; noteY: number } | null>(null);
  const lastMoveRef = useRef<{ x: number; time: number }>({ x: 0, time: 0 });
  const isDraggingRef = useRef(false);
  const didDuplicateRef = useRef(false);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const { dragRotation, applyDragVelocity, releaseSpring } = useDragRotation(opts.onDragRotation);

  // Smoothed position via lerp
  const targetPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const smoothPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const smoothRaf = useRef<number>(0);

  const tickSmooth = useCallback(() => {
    const { noteId, onDragMove } = optsRef.current;
    const sx = smoothPos.current.x + (targetPos.current.x - smoothPos.current.x) * DRAG_LERP_FACTOR;
    const sy = smoothPos.current.y + (targetPos.current.y - smoothPos.current.y) * DRAG_LERP_FACTOR;
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

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const { isOpen, openProgress, positionX, positionY, noteId, onBringToFront } = optsRef.current;
      if (isOpen || openProgress > 0.1) return;
      if (e.button !== 0) return;

      dragStart.current = { px: e.clientX, py: e.clientY, noteX: positionX, noteY: positionY };
      didDuplicateRef.current = false;
      // Hold-without-moving for 100ms also counts as drag intent (the
      // user pressed deliberately). Quick tap-and-release before this
      // fires keeps isPressed false → no animation, just open.
      pressTimerRef.current = window.setTimeout(() => {
        setIsPressed(true);
      }, 100);
      onBringToFront(noteId);

      // Attach listeners synchronously to avoid missing fast pointerup
      const onMove = (me: PointerEvent) => {
        if (!dragStart.current) return;
        const { scale, noteId: nid, onDragStart } = optsRef.current;
        const dx = (me.clientX - dragStart.current.px) / scale;
        const dy = (me.clientY - dragStart.current.py) / scale;
        // Any movement at all signals drag intent — arm the press visual
        // immediately so the scale-down has time to animate before the
        // 8px-threshold drag actually starts.
        if (!isDraggingRef.current && (dx !== 0 || dy !== 0) && pressTimerRef.current) {
          clearTimeout(pressTimerRef.current);
          pressTimerRef.current = 0;
          setIsPressed(true);
        }
        if (!isDraggingRef.current && Math.abs(dx) + Math.abs(dy) > 8 / scale) {
          isDraggingRef.current = true;
          setIsDragging(true);
          // Option+drag → duplicate before starting the drag
          if (me.altKey && !didDuplicateRef.current) {
            didDuplicateRef.current = true;
            optsRef.current.onDragDuplicate?.(nid);
          }
          onDragStart(nid);
          lastMoveRef.current = { x: me.clientX, time: performance.now() };
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
          const vx = (me.clientX - lastMoveRef.current.x) / dt;
          applyDragVelocity(vx * 1000);
          lastMoveRef.current = { x: me.clientX, time: now };
        }
      };

      const onUp = (ue: PointerEvent) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        if (!dragStart.current) return;
        const { noteId: nid, onTap, onShiftTap, onDragEnd, onDragMove } = optsRef.current;
        if (smoothRaf.current) {
          cancelAnimationFrame(smoothRaf.current);
          smoothRaf.current = 0;
        }
        if (!isDraggingRef.current) {
          if (ue.shiftKey) onShiftTap(nid);
          else onTap(nid);
        } else {
          onDragMove(nid, targetPos.current.x, targetPos.current.y);
          onDragEnd(nid);
        }
        dragStart.current = null;
        isDraggingRef.current = false;
        if (pressTimerRef.current) {
          clearTimeout(pressTimerRef.current);
          pressTimerRef.current = 0;
        }
        setIsDragging(false);
        setIsPressed(false);
        releaseSpring();
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [applyDragVelocity, releaseSpring, tickSmooth]
  );

  return { isDragging, isPressed, dragRotation, handlePointerDown };
}
