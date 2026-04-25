import { useEffect, type RefObject } from "react";

/**
 * Closes a floating menu on Escape or on a click that lands outside every
 * provided ref (each treated as a region that should NOT trigger a close).
 * Pass `enabled: false` for menus that mount permanently and gate the close
 * on an open flag.
 */
export function useMenuDismiss(
  refs: Array<RefObject<HTMLElement | null>>,
  onClose: () => void,
  enabled: boolean = true,
) {
  useEffect(() => {
    if (!enabled) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      for (const r of refs) {
        if (r.current?.contains(target)) return;
      }
      onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", handleClick, true);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("pointerdown", handleClick, true);
      window.removeEventListener("keydown", handleKey);
    };
    // refs are stable RefObject identities — exclude from deps to avoid
    // re-attaching every render when the array literal changes identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, onClose]);
}
