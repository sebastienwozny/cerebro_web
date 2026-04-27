import { useCallback, useRef, useState } from "react";
import gsap from "gsap";
import type { CanvasTransform } from "../store/useCanvas";
import { OPEN_DURATION, CLOSE_DURATION } from "../constants";

export interface AnimTuning {
  openDuration: number;
  openEase: string;
  closeDuration: number;
  closeEase: string;
}

export const DEFAULT_ANIM_TUNING: AnimTuning = {
  openDuration: OPEN_DURATION,
  openEase: "power3.out",
  closeDuration: CLOSE_DURATION,
  closeEase: "power3.out",
};

/** Per-card-type animation overrides. The active tuning for an open
 *  session is picked at openNote() time (passed as a 2nd arg) and
 *  reused for the matching close. */
export const URL_CARD_ANIM_TUNING: AnimTuning = {
  openDuration: 0.8,
  openEase: "power3.out",
  closeDuration: 0.8,
  closeEase: "power3.out",
};

export function useOpenClose(
  bringToFront: (id: string) => void,
  getTransform: () => CanvasTransform,
  tuning: AnimTuning = DEFAULT_ANIM_TUNING,
) {
  // Live-read ref so the in-flight tween reads the latest tuning each
  // call without us threading the value through every render.
  const tuningRef = useRef(tuning);
  tuningRef.current = tuning;
  // Per-call override set at openNote time. Used for the matching
  // close so a card always animates with its own pace. Cleared on
  // close completion.
  const sessionTuningRef = useRef<AnimTuning | null>(null);
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [openProgress, setOpenProgress] = useState(0);
  const [isClosing, setIsClosing] = useState(false);
  const [closingScrollOffset, setClosingScrollOffset] = useState(0);
  const [openTransform, setOpenTransform] = useState({ offsetX: 0, offsetY: 0, scale: 0.5 });
  const progressRef = useRef({ value: 0 });
  const tweenRef = useRef<gsap.core.Tween | null>(null);

  const openNote = useCallback(
    (id: string, override?: AnimTuning) => {
      sessionTuningRef.current = override ?? null;
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
      const t = sessionTuningRef.current ?? tuningRef.current;
      tweenRef.current = gsap.to(progressRef.current, {
        value: 1,
        duration: t.openDuration,
        ease: t.openEase,
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
    const t = sessionTuningRef.current ?? tuningRef.current;
    tweenRef.current = gsap.to(progressRef.current, {
      value: 0,
      duration: t.closeDuration,
      ease: t.closeEase,
      onUpdate: () => setOpenProgress(progressRef.current.value),
      onComplete: () => {
        progressRef.current.value = 0;
        setOpenProgress(0);
        setOpenNoteId(null);
        setClosingScrollOffset(0);
        sessionTuningRef.current = null;
      },
    });
  }, []);

  return { openNoteId, openProgress, isClosing, closingScrollOffset, openTransform, openNote, closeNote };
}
