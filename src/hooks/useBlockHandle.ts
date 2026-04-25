import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";

export interface HandlePos {
  contentLeft: number;
  lineH: number;
  lineBottom: number;
}

interface Args {
  editor: Editor | null;
  editable: boolean;
  showPlusMenu: boolean;
  showBlockMenu: boolean;
  hasSelection: boolean;
  plusMenuRef: RefObject<HTMLDivElement | null>;
}

// Must match GlobalDragHandle.configure({ dragHandleWidth })
const DRAG_WIDTH = 36;
const SELECTORS = "li, p:not(:first-child), pre, blockquote, h1, h2, h3, h4, h5, h6";
// px to the left of tiptap where handles still react (outside editor bounds)
const MARGIN_BAND = 120;

export function useBlockHandle({ editor, editable, showPlusMenu, showBlockMenu, hasSelection, plusMenuRef }: Args) {
  const [handlePos, setHandlePos] = useState<HandlePos | null>(null);
  const [handleBlockPos, setHandleBlockPos] = useState<number | null>(null);
  const editorWrapRef = useRef<HTMLDivElement>(null);
  const hoveredBlockRef = useRef<HTMLElement | null>(null);
  const computeFromBlockRef = useRef<((found: HTMLElement) => void) | null>(null);
  const showPlusMenuRef = useRef(showPlusMenu);
  showPlusMenuRef.current = showPlusMenu;
  const showBlockMenuRef = useRef(showBlockMenu);
  showBlockMenuRef.current = showBlockMenu;

  // Tracks the hovered block so the slash menu has a position to anchor to.
  // We also override the grip icon's position imperatively because the
  // extension's own logic mispositions it for list items, code blocks, and
  // task items.
  useEffect(() => {
    if (!editor || !editable) return;
    const tiptap = editor.view.dom as HTMLElement;

    const computeFromBlock = (found: HTMLElement) => {
      const cs = getComputedStyle(found);
      const parsedLH = parseInt(cs.lineHeight, 10);
      const lineHeight = isNaN(parsedLH) ? parseInt(cs.fontSize, 10) * 1.2 : parsedLH;
      const paddingTop = parseInt(cs.paddingTop, 10) || 0;
      const rect = found.getBoundingClientRect();
      let top = rect.top + paddingTop + (lineHeight - 24) / 2;
      // Code blocks: pin the grip to the very top of the pre (above the
      // first line of code, in the padding-top header zone).
      if (found.matches("pre")) top = rect.top;
      // Task items: the checkbox sits 5px lower than text baseline
      // (via `label { margin-top: 5px }`), so align handles to its center instead.
      if (found.matches('ul[data-type="taskList"] li')) {
        const label = found.querySelector("label") as HTMLElement | null;
        const checkbox = label?.querySelector('input[type="checkbox"]') as HTMLElement | null;
        if (checkbox) {
          const cbRect = checkbox.getBoundingClientRect();
          top = cbRect.top + (cbRect.height - 24) / 2;
        }
      }
      const dragLeft = rect.left - DRAG_WIDTH - 6;
      // For list items, `rect.left` is the bullet/checkbox's left (they're
      // flex children of the li), so aligning the menu with it puts the menu
      // under the marker — matching how paragraphs land on their own text left.
      const contentLeft = rect.left;
      // Bottom of the block's first line — used to anchor the menu directly
      // below the cursor's line regardless of the block's font-size.
      const lineBottom = rect.top + paddingTop + lineHeight;
      return { top, dragLeft, contentLeft, lineHeight, lineBottom };
    };

    // Synchronous (no rAF) imperative override of the extension's grip
    // position — the extension mispositions it for list items / pre / task
    // items, so we recompute and snap the element ourselves.
    const syncDragHandle = (dragLeft: number, top: number) => {
      const parent = tiptap.parentElement;
      const dragEl = parent?.querySelector(".drag-handle[data-drag-handle]") as HTMLElement | null;
      if (dragEl) {
        dragEl.style.left = `${dragLeft}px`;
        dragEl.style.top = `${top}px`;
      }
    };

    computeFromBlockRef.current = (found: HTMLElement) => {
      editorWrapRef.current?.classList.remove("handles-hidden");
      const { top, dragLeft, contentLeft, lineHeight, lineBottom } = computeFromBlock(found);
      if (!showPlusMenu) {
        setHandlePos({ contentLeft, lineH: lineHeight, lineBottom });
      }
      syncDragHandle(dragLeft, top);
      const menu = plusMenuRef.current;
      if (menu) {
        menu.style.left = `${contentLeft}px`;
        menu.style.top = `${lineBottom + 8}px`;
      }
    };

    const resolveBlockPos = (probeX: number, probeY: number) => {
      const result = editor.view.posAtCoords({ left: probeX, top: probeY });
      if (!result) return;
      const $p = editor.state.doc.resolve(result.pos);
      // `TextSelection.near` snaps to the nearest valid text position, so its
      // `$anchor` is guaranteed to sit inside a textblock (paragraph, heading,
      // etc.). Without this, probing over a list item's right edge can yield
      // a position on the <li> boundary — invalid for setTextSelection.
      const near = TextSelection.near($p);
      setHandleBlockPos(near.$anchor.end());
    };

    const findBlockAt = (x: number, y: number): HTMLElement | undefined =>
      document.elementsFromPoint(x, y).find((el) => {
        // Skip list containers — we want the <li>, not the whole <ul>/<ol>.
        // (ul/ol are direct children of the editor root, so the generic
        // `parentElement === tiptap` check below would otherwise match them.)
        if (el.matches("ul, ol")) return false;
        return el.parentElement === tiptap || el.matches(SELECTORS);
      }) as HTMLElement | undefined;

    const onMove = (e: MouseEvent) => {
      if (showPlusMenu || showBlockMenu || hasSelection) return;
      const probeX = e.clientX + 50 + DRAG_WIDTH;
      const probeY = e.clientY;
      const found = findBlockAt(probeX, probeY);
      if (!found) return;

      hoveredBlockRef.current = found;
      editorWrapRef.current?.classList.remove("handles-hidden");
      const { top, dragLeft, contentLeft, lineHeight, lineBottom } = computeFromBlock(found);
      setHandlePos({ contentLeft, lineH: lineHeight, lineBottom });
      syncDragHandle(dragLeft, top);
      resolveBlockPos(probeX, probeY);
    };

    // Window-level listener gated to the narrow band immediately to the left
    // of tiptap so hovering in that gutter (outside tiptap) also triggers the
    // handles for the row at cursor y.
    const onMarginMove = (e: MouseEvent) => {
      if (showPlusMenu || showBlockMenu || hasSelection) return;
      const tiptapRect = tiptap.getBoundingClientRect();
      if (e.clientX >= tiptapRect.left) return; // right of tiptap → onMove handles it
      if (e.clientX < tiptapRect.left - MARGIN_BAND) return;
      if (e.clientY < tiptapRect.top || e.clientY > tiptapRect.bottom) return;

      const probeX = tiptapRect.left + 20;
      const probeY = e.clientY;
      const found = findBlockAt(probeX, probeY);
      if (!found) return;

      hoveredBlockRef.current = found;
      editorWrapRef.current?.classList.remove("handles-hidden");
      const { top, dragLeft, contentLeft, lineHeight, lineBottom } = computeFromBlock(found);
      setHandlePos({ contentLeft, lineH: lineHeight, lineBottom });
      syncDragHandle(dragLeft, top);
      // Extension hides its drag handle on tiptap mouseout; force-show while
      // we're anchored to a block in the margin band.
      const dragEl = tiptap.parentElement?.querySelector(".drag-handle[data-drag-handle]") as HTMLElement | null;
      dragEl?.classList.remove("hide");
      resolveBlockPos(probeX, probeY);
    };

    tiptap.addEventListener("mousemove", onMove);
    window.addEventListener("mousemove", onMarginMove);
    return () => {
      tiptap.removeEventListener("mousemove", onMove);
      window.removeEventListener("mousemove", onMarginMove);
    };
  }, [editor, editable, showPlusMenu, showBlockMenu, hasSelection, plusMenuRef]);

  // Hide handles while scrolling. The browser GPU-composites the scroll before
  // the JS event fires, so any position update lags behind and looks like
  // inertia. Hiding on scroll and clearing state means handles only reappear
  // on the next mousemove — no lag, standard editor UX.
  useEffect(() => {
    const onScroll = () => {
      if (showPlusMenuRef.current || showBlockMenuRef.current) return;
      editorWrapRef.current?.classList.add("handles-hidden");
      setHandlePos(null);
      hoveredBlockRef.current = null;
    };
    const onResize = () => {
      if (showPlusMenuRef.current || showBlockMenuRef.current) return;
      const block = hoveredBlockRef.current;
      if (!block || !block.isConnected) return;
      computeFromBlockRef.current?.(block);
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  // Force-hide the extension's drag handle while the "+" menu is open or while
  // the user has a text selection (so the format toolbar isn't fighting for
  // attention with the block handles).
  useEffect(() => {
    const parent = editor?.view.dom.parentElement;
    const dragEl = parent?.querySelector(".drag-handle[data-drag-handle]") as HTMLElement | null;
    if (!dragEl) return;
    if (showPlusMenu || hasSelection) {
      dragEl.style.opacity = "0";
      dragEl.style.pointerEvents = "none";
    } else {
      dragEl.style.opacity = "";
      dragEl.style.pointerEvents = "";
    }
  }, [showPlusMenu, hasSelection, editor]);

  // When the plus menu closes OR a text selection is cleared, clear the stored
  // handle position so our "+" hides until the next mousemove (which
  // repositions it against the hovered block). Also add `hide` to the extension
  // drag handle so it doesn't flash alone at its last extension-tracked
  // position (which may differ from our sync). Next mousemove removes the
  // class and re-syncs both handles together.
  const resetHandles = useCallback(() => {
    setHandlePos(null);
    hoveredBlockRef.current = null;
    const parent = editor?.view.dom.parentElement;
    const dragEl = parent?.querySelector(".drag-handle[data-drag-handle]") as HTMLElement | null;
    dragEl?.classList.add("hide");
  }, [editor]);
  const prevShowPlusRef = useRef(false);
  useEffect(() => {
    if (prevShowPlusRef.current && !showPlusMenu) resetHandles();
    prevShowPlusRef.current = showPlusMenu;
  }, [showPlusMenu, resetHandles]);
  const prevShowBlockMenuRef = useRef(false);
  useEffect(() => {
    if (prevShowBlockMenuRef.current && !showBlockMenu) resetHandles();
    prevShowBlockMenuRef.current = showBlockMenu;
  }, [showBlockMenu, resetHandles]);

  // Freeze all handles while the block menu is open by blocking pointer
  // events on the editor DOM — the global-drag-handle extension listens for
  // mousemove on it, so disabling the events stops it from updating the grip
  // position (and the `hide` class) as the cursor moves across blocks.
  useEffect(() => {
    if (!editor || !showBlockMenu) return;
    const tiptap = editor.view.dom as HTMLElement;
    const prev = tiptap.style.pointerEvents;
    tiptap.style.pointerEvents = "none";
    return () => {
      tiptap.style.pointerEvents = prev;
    };
  }, [showBlockMenu, editor]);
  const prevHasSelectionRef = useRef(false);
  useEffect(() => {
    if (prevHasSelectionRef.current && !hasSelection) resetHandles();
    prevHasSelectionRef.current = hasSelection;
  }, [hasSelection, resetHandles]);

  return {
    handlePos,
    handleBlockPos,
    editorWrapRef,
    hoveredBlockRef,
    computeFromBlockRef,
  };
}
