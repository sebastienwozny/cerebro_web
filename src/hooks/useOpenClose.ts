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
      console.log("[useOpenClose] openNote", { id });
      bringToFront(id);
      setOpenTransform({ ...getTransform() });
      setOpenNoteId(id);
      setIsClosing(false);
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
    console.log("[useOpenClose] closeNote called -> setIsClosing(true)");
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
        console.log("[useOpenClose] close onComplete -> clearing openNoteId, openProgress=0");
        progressRef.current.value = 0;
        setOpenProgress(0);
        setOpenNoteId(null);
        setClosingScrollOffset(0);
      },
    });
  }, []);

  return { openNoteId, openProgress, isClosing, closingScrollOffset, openTransform, openNote, closeNote };
}
