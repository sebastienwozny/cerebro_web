import { useCallback, useRef, useState } from "react";
import gsap from "gsap";
import type { CanvasTransform } from "../store/useCanvas";
import { OPEN_DURATION, CLOSE_DURATION } from "../constants";

export function useOpenClose(
  bringToFront: (id: string) => void,
  getTransform: () => CanvasTransform,
) {
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [openProgress, setOpenProgress] = useState(0);
  const [isClosing, setIsClosing] = useState(false);
  const [closingScrollOffset, setClosingScrollOffset] = useState(0);
  const [openTransform, setOpenTransform] = useState({ offsetX: 0, offsetY: 0, scale: 0.5 });
  const progressRef = useRef({ value: 0 });
  const tweenRef = useRef<gsap.core.Tween | null>(null);

  const openNote = useCallback(
    (id: string) => {
      bringToFront(id);
      setOpenTransform({ ...getTransform() });
      setOpenNoteId(id);
      setIsClosing(false);
      // Seed progress to a tiny positive value so the opening card is rendered
      // (openProgress > 0 gate) and portalToBody activates in the SAME React
      // render as the tap — eliminating the one-frame gap where the canvas card
      // div is hidden but the opening card hasn't appeared yet (the saccade).
      progressRef.current.value = 0.001;
      setOpenProgress(0.001);
      tweenRef.current?.kill();
      tweenRef.current = gsap.to(progressRef.current, {
        value: 1,
        duration: OPEN_DURATION,
        ease: "power3.out",
        onUpdate: () => setOpenProgress(progressRef.current.value),
      });
    },
    [bringToFront, getTransform]
  );

  const closeNote = useCallback(() => {
    const scrollEl = document.querySelector("[data-editor-overlay]") as HTMLElement | null;
    setClosingScrollOffset(scrollEl?.scrollTop ?? 0);
    setIsClosing(true);
    tweenRef.current?.kill();
    tweenRef.current = gsap.to(progressRef.current, {
      value: 0,
      duration: CLOSE_DURATION,
      ease: "power3.out",
      onUpdate: () => setOpenProgress(progressRef.current.value),
      onComplete: () => {
        progressRef.current.value = 0;
        setOpenProgress(0);
        setOpenNoteId(null);
        setClosingScrollOffset(0);
      },
    });
  }, []);

  return { openNoteId, openProgress, isClosing, closingScrollOffset, openTransform, openNote, closeNote };
}
