import { useCallback, useEffect, useRef, useState } from "react";
import type { Note } from "../store/db";
import type { CanvasTransform } from "../store/useCanvas";
import { getCardSize } from "../lib/cardDimensions";

export interface MarqueeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function useSelection(
  notes: Note[],
  canvasLocked: boolean,
  getTransform: () => CanvasTransform,
  windowW: number,
  windowH: number,
) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);
  const marqueeStart = useRef<{ x: number; y: number } | null>(null);
  const didMarquee = useRef(false);
  const notesRef = useRef(notes);
  notesRef.current = notes;

  // Shift+click on a card — always add (never remove)
  const selectNote = useCallback((noteId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.add(noteId);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(notesRef.current.map(n => n.id)));
  }, []);

  // Marquee — pointerdown on canvas background
  const handleMarqueeDown = useCallback(
    (e: React.PointerEvent) => {
      if (canvasLocked) return;
      if ((e.target as HTMLElement).closest("[data-notecard]")) return;
      marqueeStart.current = { x: e.clientX, y: e.clientY };
      didMarquee.current = false;
    },
    [canvasLocked]
  );

  useEffect(() => {
    if (canvasLocked) return;

    const onMove = (e: PointerEvent) => {
      if (!marqueeStart.current) return;
      const dx = e.clientX - marqueeStart.current.x;
      const dy = e.clientY - marqueeStart.current.y;
      if (!didMarquee.current && Math.abs(dx) + Math.abs(dy) < 4) return;
      didMarquee.current = true;

      const rect: MarqueeRect = {
        x: Math.min(marqueeStart.current.x, e.clientX),
        y: Math.min(marqueeStart.current.y, e.clientY),
        w: Math.abs(dx),
        h: Math.abs(dy),
      };
      setMarquee(rect);

      const t = getTransform();
      const hit = new Set<string>();
      for (const note of notesRef.current) {
        const { w: cardW, h: cardH } = getCardSize(note);
        const cx = windowW / 2 + note.positionX * t.scale + t.offsetX;
        const cy = windowH / 2 + note.positionY * t.scale + t.offsetY;
        const halfW = (cardW * t.scale) / 2;
        const halfH = (cardH * t.scale) / 2;
        if (
          cx + halfW > rect.x &&
          cx - halfW < rect.x + rect.w &&
          cy + halfH > rect.y &&
          cy - halfH < rect.y + rect.h
        ) {
          hit.add(note.id);
        }
      }
      setSelectedIds(hit);
    };

    const onUp = () => {
      // If we didn't drag a marquee, it was a click on empty canvas — clear selection
      if (marqueeStart.current && !didMarquee.current) {
        setSelectedIds(new Set());
      }
      marqueeStart.current = null;
      didMarquee.current = false;
      setMarquee(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [canvasLocked, getTransform, windowW, windowH]);

  return {
    selectedIds,
    setSelectedIds,
    marquee,
    selectNote,
    clearSelection,
    selectAll,
    handleMarqueeDown,
  };
}
