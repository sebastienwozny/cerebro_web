import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";

interface PopupState {
  href: string;
  left: number;
  top: number;
}

/**
 * Tracks hover/focus on `<a>` elements inside the editor and exposes the
 * anchor rect + href. The consumer renders the floating "Open ↗" button.
 *
 * Why hover, not "openOnClick: true": single-clicking a link in a
 * (always-editable) Tiptap editor should still place the caret — a
 * separate explicit open affordance avoids that ambiguity.
 */
export function useLinkHoverPopup(editor: Editor | null) {
  const [popup, setPopup] = useState<PopupState | null>(null);
  // Drives the entrance/exit transition. The pill renders mounted-but-
  // invisible first, then `visible` flips to true on the next frame so
  // the CSS transition runs from opacity 0 → 1.
  const [visible, setVisible] = useState(false);
  const hideTimerRef = useRef<number | null>(null);
  const unmountTimerRef = useRef<number | null>(null);
  // The currently-decorated `<a>` element. Tracked so we can remove the
  // `link-hovered` class as the popup transitions or hides — the CSS
  // `:hover` state alone can't keep the link styled once the cursor
  // leaves it for the popup pill.
  const activeLinkRef = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    if (!editor) return;
    let dom: HTMLElement;
    try { dom = editor.view.dom as HTMLElement; } catch { return; }

    const cancelHide = () => {
      if (hideTimerRef.current !== null) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };
    const cancelUnmount = () => {
      if (unmountTimerRef.current !== null) {
        clearTimeout(unmountTimerRef.current);
        unmountTimerRef.current = null;
      }
    };
    const clearActive = () => {
      activeLinkRef.current?.classList.remove("link-hovered");
      activeLinkRef.current = null;
    };
    const beginHide = () => {
      // Two-phase: flip `visible` off (drives the fade-out CSS transition),
      // then unmount once the transition has finished. Re-entering the link
      // or pill cancels both timers and brings us back to fully visible.
      setVisible(false);
      clearActive();
      cancelUnmount();
      unmountTimerRef.current = window.setTimeout(() => {
        setPopup(null);
        unmountTimerRef.current = null;
      }, 120);
    };
    const scheduleHide = () => {
      cancelHide();
      hideTimerRef.current = window.setTimeout(beginHide, 60);
    };

    const onMouseOver = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest("a") as HTMLAnchorElement | null;
      if (!a || !dom.contains(a) || !a.href) return;
      cancelHide();
      cancelUnmount();
      if (activeLinkRef.current && activeLinkRef.current !== a) {
        activeLinkRef.current.classList.remove("link-hovered");
      }
      activeLinkRef.current = a;
      a.classList.add("link-hovered");
      const r = a.getBoundingClientRect();
      setPopup({ href: a.href, left: r.left + r.width / 2, top: r.top });
      // Double RAF so the initial render (with opacity:0 + scale:0.5)
      // actually paints before we flip to .visible. A single RAF can land
      // in the same frame as the React commit, leaving no "from" state
      // for the transition to interpolate from — the pill would snap in.
      requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
    };

    const onMouseOut = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest("a");
      if (!a) return;
      const next = e.relatedTarget as HTMLElement | null;
      if (next?.closest?.("[data-link-hover-popup]")) return;
      scheduleHide();
    };

    const onScroll = () => beginHide();

    dom.addEventListener("mouseover", onMouseOver);
    dom.addEventListener("mouseout", onMouseOut);
    const overlay = dom.closest("[data-editor-overlay]");
    overlay?.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      dom.removeEventListener("mouseover", onMouseOver);
      dom.removeEventListener("mouseout", onMouseOut);
      overlay?.removeEventListener("scroll", onScroll);
      cancelHide();
      cancelUnmount();
      clearActive();
    };
  }, [editor]);

  const onPopupEnter = () => {
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    if (unmountTimerRef.current !== null) {
      clearTimeout(unmountTimerRef.current);
      unmountTimerRef.current = null;
    }
    setVisible(true);
  };
  const onPopupLeave = () => {
    if (hideTimerRef.current !== null) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      setVisible(false);
      activeLinkRef.current?.classList.remove("link-hovered");
      activeLinkRef.current = null;
      if (unmountTimerRef.current !== null) clearTimeout(unmountTimerRef.current);
      unmountTimerRef.current = window.setTimeout(() => {
        setPopup(null);
        unmountTimerRef.current = null;
      }, 120);
    }, 60);
  };
  const dismiss = () => {
    setVisible(false);
    activeLinkRef.current?.classList.remove("link-hovered");
    activeLinkRef.current = null;
    if (hideTimerRef.current !== null) clearTimeout(hideTimerRef.current);
    if (unmountTimerRef.current !== null) clearTimeout(unmountTimerRef.current);
    unmountTimerRef.current = window.setTimeout(() => {
      setPopup(null);
      unmountTimerRef.current = null;
    }, 140);
  };

  return { popup, visible, onPopupEnter, onPopupLeave, dismiss };
}
