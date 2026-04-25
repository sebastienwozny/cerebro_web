import { useEffect, useLayoutEffect, useRef, useState } from "react";

interface Params {
  isDragging: boolean;
  isResizingRef: React.MutableRefObject<boolean>;
  cardRef: React.RefObject<HTMLElement | null>;
  isOpen: boolean;
  hoverSuppressed: boolean;
  isPopping?: boolean;
  openProgress: number;
}

/**
 * Manages hover state for NoteCard with two levels:
 * - isHovered: full visual hover (scale effect) — suppressed after drag/resize until re-enter
 * - isPointerOver: lightweight pointer tracking — used for resize corner visibility
 */
export function useCardHover({
  isDragging,
  isResizingRef,
  cardRef,
  isOpen,
  hoverSuppressed,
  isPopping,
  openProgress,
}: Params) {
  const [isHovered, setIsHovered] = useState(false);
  const [isPointerOver, setIsPointerOver] = useState(false);
  const [suppressScale, setSuppressScale] = useState(false);
  const hoverCooldownRef = useRef(false);

  // Clear hover when drag starts, restore pointer state when drag ends if still over card.
  // Uses useLayoutEffect so the post-drag cooldown is armed BEFORE the browser
  // fires its synthetic mouseenter at the card's reset position.
  useLayoutEffect(() => {
    if (isDragging) {
      setIsHovered(false);
      setSuppressScale(true);
      hoverCooldownRef.current = true;
    } else {
      if (cardRef.current?.matches(":hover")) {
        setIsPointerOver(true);
      }
      // Keep the cooldown for ~250ms after drag end so the synthetic
      // onMouseEnter that the browser fires right after pointerup doesn't
      // snap straight back into the hover scale + shadow. Hover only
      // re-engages when the user actually moves out and back in.
      hoverCooldownRef.current = true;
      const timer = setTimeout(() => { hoverCooldownRef.current = false; }, 250);
      return () => clearTimeout(timer);
    }
  }, [isDragging]);

  // Reset pointer state when a card opens, hover gets suppressed, or selection changes
  // Brief cooldown after suppression ends to ignore stale mouseEnter events
  useEffect(() => {
    if (isOpen || hoverSuppressed) {
      setIsPointerOver(false);
      setIsHovered(false);
      hoverCooldownRef.current = true;
    } else {
      hoverCooldownRef.current = true;
      const timer = setTimeout(() => { hoverCooldownRef.current = false; }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen, hoverSuppressed]);

  const t = openProgress;

  const onMouseEnter = () => {
    if (hoverCooldownRef.current) return;
    setSuppressScale(false);
    setIsPointerOver(true);
    if (!isOpen && !hoverSuppressed && !isPopping && !isResizingRef.current && t < 0.1) {
      setIsHovered(true);
    }
  };

  const onMouseLeave = (e: React.MouseEvent) => {
    // If the pointer is still within the card's bounding rect, it moved onto
    // a portal overlay (e.g. PVP corner handle) — don't clear hover state.
    const rect = cardRef.current?.getBoundingClientRect();
    if (rect) {
      const { clientX: x, clientY: y } = e;
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return;
    }
    setIsPointerOver(false);
    setIsHovered(false);
  };

  const onInteractionStart = () => {
    setSuppressScale(true);
    setIsPointerOver(false);
  };

  const onResizeEnd = () => {
    if (cardRef.current?.matches(":hover")) {
      setIsPointerOver(true);
    }
  };

  return {
    isHovered,
    isPointerOver,
    suppressScale,
    onMouseEnter,
    onMouseLeave,
    onInteractionStart,
    onResizeEnd,
  };
}
