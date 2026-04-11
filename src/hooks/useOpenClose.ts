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
  const [closingScrollOffset, setClosingScrollOffset] = useState(0);
  const [openTransform, setOpenTransform] = useState({ offsetX: 0, offsetY: 0, scale: 0.5 });
  const progressRef = useRef({ value: 0 });
  const tweenRef = useRef<gsap.core.Tween | null>(null);

  const openNote = useCallback(
    (id: string) => {
      bringToFront(id);
      setOpenTransform({ ...getTransform() });
      setOpenNoteId(id);
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
    tweenRef.current?.kill();
    tweenRef.current = gsap.to(progressRef.current, {
      value: 0,
      duration: CLOSE_DURATION,
      ease: "power3.out",
      onUpdate: () => setOpenProgress(progressRef.current.value),
      onComplete: () => { setOpenNoteId(null); setClosingScrollOffset(0); },
    });
  }, []);

  return { openNoteId, openProgress, closingScrollOffset, openTransform, openNote, closeNote };
}
