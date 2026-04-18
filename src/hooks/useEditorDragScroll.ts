import { useEffect } from "react";
import type { Editor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";

/**
 * Wires two drag-handle side-effects for the TipTap editor:
 *
 * 1. When a drag starts from the global drag-handle but there is a partial
 *    TextSelection, replace it with a whole-block NodeSelection so the
 *    extension doesn't drag only the highlighted sub-range.
 *
 * 2. Auto-scroll the `[data-editor-overlay]` container while a block is being
 *    dragged. The extension's built-in drag-scroll acts on `window`, which
 *    does nothing when the editor lives inside an internally-scrolled
 *    overlay. We mirror the behavior with a wider threshold for a comfier
 *    drop zone.
 */
export function useEditorDragScroll(editor: Editor | null, editable: boolean) {
  useEffect(() => {
    if (!editor || !editable) return;

    const onDragStart = (e: DragEvent) => {
      const target = e.target as HTMLElement;
      if (!target?.dataset?.dragHandle && target?.dataset?.dragHandle !== "") return;
      const { selection } = editor.state;
      if (!selection.empty && !(selection instanceof NodeSelection)) {
        const tr = editor.state.tr.setSelection(
          NodeSelection.create(editor.state.doc, editor.state.selection.$from.before(1))
        );
        editor.view.dispatch(tr);
      }
    };

    window.addEventListener("dragstart", onDragStart, true);
    return () => window.removeEventListener("dragstart", onDragStart, true);
  }, [editor, editable]);

  useEffect(() => {
    if (!editor || !editable) return;
    const overlay = editor.view.dom.closest("[data-editor-overlay]") as HTMLElement | null;
    if (!overlay) return;
    const THRESHOLD = 120;
    const MAX_SPEED = 18;
    let dragging = false;

    const onDragStart = (e: DragEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || !("dragHandle" in (t.dataset ?? {}))) return;
      dragging = true;
    };
    const onDragEnd = () => { dragging = false; };
    const onDrag = (e: DragEvent) => {
      // Last `drag` event in a sequence often has clientY = 0 — skip it.
      if (!dragging || e.clientY === 0) return;
      const rect = overlay.getBoundingClientRect();
      const topDist = e.clientY - rect.top;
      const bottomDist = rect.bottom - e.clientY;
      if (topDist < THRESHOLD && topDist >= 0) {
        const factor = 1 - topDist / THRESHOLD;
        overlay.scrollTop -= MAX_SPEED * factor;
      } else if (bottomDist < THRESHOLD && bottomDist >= 0) {
        const factor = 1 - bottomDist / THRESHOLD;
        overlay.scrollTop += MAX_SPEED * factor;
      }
    };

    window.addEventListener("dragstart", onDragStart, true);
    window.addEventListener("dragend", onDragEnd, true);
    window.addEventListener("drag", onDrag);
    return () => {
      window.removeEventListener("dragstart", onDragStart, true);
      window.removeEventListener("dragend", onDragEnd, true);
      window.removeEventListener("drag", onDrag);
    };
  }, [editor, editable]);
}
