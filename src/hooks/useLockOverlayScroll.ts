import { useEffect } from "react";

/**
 * Lock scrolling on the editor's `[data-editor-overlay]` container for the
 * lifetime of the calling component. Compensates for the vanishing scrollbar
 * with padding-right so content doesn't jump horizontally.
 */
export function useLockOverlayScroll() {
  useEffect(() => {
    const overlay = document.querySelector("[data-editor-overlay]") as HTMLElement | null;
    if (!overlay) return;
    const scrollbarW = overlay.offsetWidth - overlay.clientWidth;
    const prevOverflow = overlay.style.overflow;
    const prevPadding = overlay.style.paddingRight;
    overlay.style.overflow = "hidden";
    if (scrollbarW > 0) overlay.style.paddingRight = `${scrollbarW}px`;
    return () => {
      overlay.style.overflow = prevOverflow;
      overlay.style.paddingRight = prevPadding;
    };
  }, []);
}
