import { useEffect, useRef, useState } from "react";

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

  // Clear hover when drag starts, restore pointer state when drag ends if still over card
  useEffect(() => {
    if (isDragging) {
      setIsHovered(false);
      setSuppressScale(true);
    } else {
      if (cardRef.current?.matches(":hover")) {
        setIsPointerOver(true);
      }
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

  const onMouseLeave = () => {
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
