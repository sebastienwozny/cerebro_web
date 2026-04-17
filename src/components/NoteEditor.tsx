import { useEditor, EditorContent } from "@tiptap/react";
import { DOMParser } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import { createPortal } from "react-dom";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import BaseImage from "@tiptap/extension-image";
import Underline from "@tiptap/extension-underline";
import GlobalDragHandle from "tiptap-extension-global-drag-handle";
import AutoJoiner from "tiptap-extension-auto-joiner";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useBlockHandle } from "../hooks/useBlockHandle";
import { useLinkMode } from "../hooks/useLinkMode";
import { Plus } from "lucide-react";
import type { NoteBlock } from "../store/db";
import { blocksToHtml, htmlToBlocks } from "../lib/blockSerializer";
import { markdownToHtml, looksLikeMarkdown } from "../lib/markdownParser";
import { SLASH_COMMANDS } from "../lib/slashCommands";
import { readImageFile } from "../lib/imageUtils";
import FormatToolbar from "./FormatToolbar";
import PlusMenu from "./PlusMenu";

// Extend Tiptap Image to carry aspect ratio
const ImageWithAspect = BaseImage.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      aspect: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const v = el.getAttribute("data-aspect");
          return v ? parseFloat(v) : null;
        },
        renderHTML: (attrs: Record<string, unknown>) => {
          if (!attrs.aspect) return {};
          return { "data-aspect": String(attrs.aspect) };
        },
      },
    };
  },
});

interface Props {
  blocks: NoteBlock[];
  onUpdate: (blocks: NoteBlock[]) => void;
  editable: boolean;
}

export default function NoteEditor({ blocks, onUpdate, editable }: Props) {
  const initialHtml = useRef(blocksToHtml(blocks));
  const [showToolbar, setShowToolbar] = useState(false);
  const [formatTooltips, setFormatTooltips] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInsertPosRef = useRef<number | null>(null);

  const [hasSelection, setHasSelection] = useState(false);
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [menuFlipUp, setMenuFlipUp] = useState(false);
  const plusMenuRef = useRef<HTMLDivElement>(null);
  const plusIdxRef = useRef(0);

  // Link-mode handlers are bound to useLinkMode's callbacks below; we refer to
  // them via refs inside useEditor's config so the (once-evaluated) handlers
  // can reach the latest version without recreating the editor.
  const enterLinkModeRef = useRef<() => void>(() => {});
  const linkOnSelectionChangeRef = useRef<(isLinkActive: boolean) => void>(() => {});

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: {
          openOnClick: false,
          HTMLAttributes: { class: "editor-link" },
        },
        dropcursor: { color: "#d4d4d4", width: 2 },
      }),
      Placeholder.configure({
        placeholder: ({ node }) => {
          if (node.type.name === "heading") return "Untitled";
          return "Press '/' for commands";
        },
        showOnlyCurrent: true,
        includeChildren: true,
      }),
      TaskList,
      TaskItem.configure({ nested: false }),
      ImageWithAspect.configure({ inline: false, allowBase64: true }),
      Underline,
      GlobalDragHandle.configure({
        dragHandleWidth: 36,
        scrollTreshold: 100,
      }),
      AutoJoiner.configure({
        elementsToJoin: ["bulletList", "orderedList", "taskList"],
      }),
    ],
    content: initialHtml.current,
    editable,
    onUpdate: ({ editor }) => {
      onUpdate(htmlToBlocks(editor as ReturnType<typeof useEditor>));
    },
    onSelectionUpdate: ({ editor }) => {
      // Don't show the style toolbar for NodeSelection — that's what the
      // drag-handle extension creates when grabbing a block, and it would
      // flash the bar during a drag.
      const sel = !editor.state.selection.empty && !(editor.state.selection instanceof NodeSelection);
      setHasSelection(sel);
      // Mirror selection state to the format bar — collapsing the selection
      // (e.g. clicking elsewhere in the editor) should hide the bar.
      setShowToolbar(sel);
      linkOnSelectionChangeRef.current(editor.isActive("link"));
    },
    editorProps: {
      scrollThreshold: 0,
      scrollMargin: 0,
      handlePaste: (view, event) => {
        const scrollEl = view.dom.closest("[data-editor-overlay]");
        const scrollTop = scrollEl?.scrollTop ?? 0;

        // Check for pasted image
        const items = Array.from(event.clipboardData?.items ?? []);
        const imageItem = items.find(item => item.type.startsWith("image/"));
        if (imageItem) {
          const file = imageItem.getAsFile();
          if (file) {
            event.preventDefault();
            insertImageFromFile(file);
            return true;
          }
        }

        const text = event.clipboardData?.getData("text/plain");
        if (text && looksLikeMarkdown(text)) {
          event.preventDefault();
          const converted = markdownToHtml(text);
          const parser = DOMParser.fromSchema(view.state.schema);
          const tempDiv = document.createElement("div");
          tempDiv.innerHTML = converted;
          const slice = parser.parseSlice(tempDiv);
          const tr = view.state.tr.replaceSelection(slice).scrollIntoView();
          view.dispatch(tr);
        }
        // Restore scroll position after paste
        requestAnimationFrame(() => {
          if (scrollEl) scrollEl.scrollTop = scrollTop;
        });
        return text && looksLikeMarkdown(text) ? true : false;
      },
      handleDrop: (_view, event) => {
        const dt = (event as DragEvent).dataTransfer;
        if (!dt) return false;
        const file = Array.from(dt.files).find(f => f.type.startsWith("image/"));
        if (file) {
          event.preventDefault();
          insertImageFromFile(file);
          return true;
        }
        return false;
      },
      handleKeyDown: (_view, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "k") {
          event.preventDefault();
          enterLinkModeRef.current();
          return true;
        }
        if (event.key === "/" && !showPlusMenu) {
          // Open the plus menu after the "/" is inserted, then delete it
          setTimeout(() => {
            if (!editor) return;
            const { from } = editor.state.selection;
            editor.chain().focus().deleteRange({ from: from - 1, to: from }).run();
            // Position the handle at the current block so the menu opens below it
            const { $from } = editor.state.selection;
            const blockPos = $from.before($from.depth);
            const domNode = editor.view.nodeDOM(blockPos) as HTMLElement | null;
            if (domNode && computeFromBlockRef.current) {
              computeFromBlockRef.current(domNode);
            }
            plusIdxRef.current = -1;
            setShowPlusMenu(true);
          }, 0);
          return false;
        }
        return false;
      },
    },
  });

  async function insertImageFromFile(file: File) {
    if (!editor) return;
    const { dataUrl, aspect } = await readImageFile(file);

    const pos = imageInsertPosRef.current;
    imageInsertPosRef.current = null;

    if (pos !== null) {
      // Insert at the position we saved before the file picker opened
      editor.chain().focus()
        .insertContentAt(pos, { type: "image", attrs: { src: dataUrl, aspect } })
        .run();
    } else {
      // Paste / drop — insert at current cursor. We use `insertContent` instead
      // of the extension's `setImage` command because TipTap's command types
      // don't pick up attributes we added via extension (like `aspect`).
      editor.chain().focus()
        .insertContent({ type: "image", attrs: { src: dataUrl, aspect } })
        .run();
    }
  }

  useEffect(() => {
    if (editor) {
      editor.setEditable(editable);
      if (editable) {
        const hasHeaderImage = editor.getJSON().content?.[0]?.type === "image";
        if (hasHeaderImage) {
          editor.commands.blur();
        } else {
          editor.commands.setTextSelection(0);
          (editor.view.dom as HTMLElement).focus({ preventScroll: true });
        }
      }
    }
  }, [editor, editable]);

  // Fix: when a drag starts from the drag handle, clear any text selection
  // so the extension creates a NodeSelection (whole block) instead of a
  // partial TextSelection covering only bold/italic spans.
  useEffect(() => {
    if (!editor || !editable) return;

    const onDragStart = (e: DragEvent) => {
      const target = e.target as HTMLElement;
      if (!target?.dataset?.dragHandle && target?.dataset?.dragHandle !== "") return;
      const { selection } = editor.state;
      if (!selection.empty && !(selection instanceof NodeSelection)) {
        // Clear the selection so the extension falls through to NodeSelection
        const tr = editor.state.tr.setSelection(
          NodeSelection.create(editor.state.doc, editor.state.selection.$from.before(1))
        );
        editor.view.dispatch(tr);
      }
    };

    window.addEventListener("dragstart", onDragStart, true);
    return () => window.removeEventListener("dragstart", onDragStart, true);
  }, [editor, editable]);

  // Auto-scroll the editor overlay while dragging a block. The extension's
  // built-in drag-scroll acts on `window`, which does nothing here since the
  // scrollable element is `[data-editor-overlay]` inside the note card. We
  // mirror the behavior with a wider threshold for a comfier drop zone.
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

  // Click below content to insert empty lines
  useEffect(() => {
    if (!editor || !editable) return;
    const overlay = editor.view.dom.closest("[data-editor-overlay]");
    if (!overlay) return;

    // Track whether mousedown started inside the editor text area
    let mouseDownInEditor = false;
    const handleOverlayPointerDown = (e: Event) => {
      const me = e as MouseEvent;
      const tiptapRect = editor.view.dom.getBoundingClientRect();
      mouseDownInEditor = me.clientX >= tiptapRect.left && me.clientX <= tiptapRect.right;
    };
    overlay.addEventListener("pointerdown", handleOverlayPointerDown);

    const handleOverlayClick = (e: Event) => {
      const me = e as MouseEvent;
      const tiptap = editor.view.dom;
      const tiptapRect = tiptap.getBoundingClientRect();

      // Click in left/right margins — clear selection and close toolbars
      // But preserve selection if the user drag-selected from inside the editor
      if (me.clientX < tiptapRect.left || me.clientX > tiptapRect.right) {
        if (!mouseDownInEditor) {
          // Explicitly collapse any NodeSelection (e.g. clicked image) so the
          // `.ProseMirror-selectednode` ring disappears. `blur()` alone keeps
          // the NodeSelection around.
          if (editor.state.selection instanceof NodeSelection) {
            editor.commands.setTextSelection(editor.state.selection.from);
          }
          editor.commands.blur();
          setShowToolbar(false);
          // `blur()` keeps the ProseMirror selection non-empty, so
          // onSelectionUpdate doesn't fire. Reset hasSelection manually so the
          // block handles ungate on the next mousemove.
          setHasSelection(false);
          exitLinkMode();
        }
        return;
      }

      const lastChild = tiptap.lastElementChild as HTMLElement | null;
      const contentBottom = lastChild
        ? lastChild.getBoundingClientRect().bottom
        : tiptapRect.top;
      if (me.clientY <= contentBottom) return;
      setShowToolbar(false);
      exitLinkMode();
      const sampleP = tiptap.querySelector("p");
      const lineH = sampleP
        ? sampleP.getBoundingClientRect().height + parseFloat(getComputedStyle(sampleP).marginBottom)
        : 40;
      const linesToAdd = Math.max(1, Math.round((me.clientY - contentBottom) / lineH));
      const paragraphs = Array.from({ length: linesToAdd }, () => ({ type: "paragraph" }));
      const endPos = editor.state.doc.content.size;
      editor.chain().insertContentAt(endPos, paragraphs).focus("end").run();
    };
    overlay.addEventListener("click", handleOverlayClick);
    return () => {
      overlay.removeEventListener("click", handleOverlayClick);
      overlay.removeEventListener("pointerdown", handleOverlayPointerDown);
    };
  }, [editor, editable]);

  const {
    linkMode,
    linkUrl,
    setLinkUrl,
    linkTooltips,
    setLinkTooltips,
    linkInputRef,
    enterLinkMode,
    exitLinkMode,
    applyLink,
    removeLink,
    onSelectionChange: onLinkSelectionChange,
  } = useLinkMode(editor, () => setShowToolbar(false));
  enterLinkModeRef.current = enterLinkMode;
  linkOnSelectionChangeRef.current = onLinkSelectionChange;

  // Drop the format-bar tooltips whenever link mode exits (so hovering the bar
  // right after closing the link input doesn't flash tooltips at the user).
  useEffect(() => {
    if (!linkMode) setFormatTooltips(false);
  }, [linkMode]);

  // ── Block handle ("+" button next to focused block) ──
  const {
    handlePos, handleBlockPos, handleHidden,
    editorWrapRef, plusBtnRef, hoveredBlockRef, computeFromBlockRef,
  } = useBlockHandle({ editor, editable, showPlusMenu, hasSelection, plusMenuRef });

  // Flip menu above the line when it would overflow the viewport bottom.
  useLayoutEffect(() => {
    if (!showPlusMenu || !handlePos) return;
    const el = plusMenuRef.current;
    if (!el) return;
    const h = el.offsetHeight;
    const viewportH = window.innerHeight;
    setMenuFlipUp(handlePos.lineBottom + 8 + h > viewportH - 8);
  }, [showPlusMenu, handlePos]);

  const highlightPlusItem = useCallback(() => {
    const menu = plusMenuRef.current;
    if (!menu) return;
    menu.querySelectorAll("[data-plus-item]").forEach((el, i) => {
      (el as HTMLElement).classList.toggle("active", i === plusIdxRef.current);
    });
  }, []);

  // Close plus menu on click outside or Escape
  useEffect(() => {
    if (!showPlusMenu) return;
    const onClick = (e: MouseEvent) => {
      if (plusMenuRef.current?.contains(e.target as Node)) return;
      if (plusBtnRef.current?.contains(e.target as Node)) return;
      setShowPlusMenu(false);
    };
    const onKey = (e: KeyboardEvent) => {
      // Close button is the last item (index === SLASH_COMMANDS.length).
      const maxIdx = SLASH_COMMANDS.length;
      if (e.key === "Escape") { e.stopPropagation(); setShowPlusMenu(false); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); plusIdxRef.current = Math.min(plusIdxRef.current + 1, maxIdx); highlightPlusItem(); }
      if (e.key === "ArrowUp") { e.preventDefault(); plusIdxRef.current = Math.max(plusIdxRef.current - 1, 0); highlightPlusItem(); }
      if (e.key === "Enter") {
        // No item highlighted (menu opened via "/" with nothing picked) —
        // close the menu and let the editor handle Enter naturally so the
        // user just breaks to a new line.
        if (plusIdxRef.current === -1) {
          setShowPlusMenu(false);
          return;
        }
        e.preventDefault();
        if (plusIdxRef.current === maxIdx) setShowPlusMenu(false);
        else handlePlusSelect(SLASH_COMMANDS[plusIdxRef.current]);
      }
      // Backspace with nothing picked — close the menu and let the editor
      // delete the previous character normally (mirrors the Enter case).
      if (e.key === "Backspace" && plusIdxRef.current === -1) {
        setShowPlusMenu(false);
      }
    };
    // Delay so the opening click doesn't immediately close
    const timer = setTimeout(() => {
      window.addEventListener("pointerdown", onClick, true);
    }, 0);
    window.addEventListener("keydown", onKey, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointerdown", onClick, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [showPlusMenu, highlightPlusItem]);

  function handlePlusClick() {
    if (!editor) return;
    if (handleBlockPos !== null) {
      editor.chain().focus().setTextSelection(handleBlockPos).run();
    }
    const { $from } = editor.state.selection;
    const parentEmpty = $from.parent.content.size === 0;
    const plusEl = plusBtnRef.current;
    const dragEl = editor.view.dom.parentElement?.querySelector(".drag-handle[data-drag-handle]") as HTMLElement | null;
    // Kill the opacity transition so the upcoming hide snaps instantly
    // instead of fading (150ms) at the new line. Restored next frame so
    // the normal fade-in/out works on subsequent hovers.
    if (plusEl) plusEl.style.transition = "none";
    if (dragEl) dragEl.style.transition = "none";
    if (!parentEmpty) {
      let liType: "listItem" | "taskItem" | null = null;
      for (let d = $from.depth; d > 0; d--) {
        const name = $from.node(d).type.name;
        if (name === "listItem" || name === "taskItem") { liType = name; break; }
      }
      if (liType) {
        editor.chain().focus().splitListItem(liType).run();
      } else {
        const blockEnd = $from.after(1);
        editor.chain().focus().insertContentAt(blockEnd, { type: "paragraph" }).setTextSelection(blockEnd + 1).run();
      }
      const pos = editor.state.selection.$from.pos;
      const dom = editor.view.domAtPos(pos).node;
      const el = (dom instanceof HTMLElement ? dom : dom.parentElement) as HTMLElement | null;
      const topLevel = el?.closest('ul > li, ol > li, .tiptap > *') as HTMLElement | null;
      if (topLevel) {
        hoveredBlockRef.current = topLevel;
        computeFromBlockRef.current?.(topLevel);
      }
    }
    plusIdxRef.current = 0;
    setShowPlusMenu((v) => !v);
    requestAnimationFrame(() => {
      if (plusEl) plusEl.style.transition = "";
      if (dragEl) dragEl.style.transition = "";
    });
  }

  function applyBlockType(cmd: (typeof SLASH_COMMANDS)[number]) {
    if (!editor) return;
    const { $from } = editor.state.selection;
    const parentEmpty = $from.parent.content.size === 0;

    if (parentEmpty) {
      switch (cmd.type) {
        case "heading1": editor.chain().focus().setHeading({ level: 1 }).run(); break;
        case "heading2": editor.chain().focus().setHeading({ level: 2 }).run(); break;
        case "heading3": editor.chain().focus().setHeading({ level: 3 }).run(); break;
        // `toggle*` would convert back to a paragraph if we're already inside
        // the target list/quote (e.g. after splitListItem from handlePlusClick).
        case "bulletList": if (!editor.isActive("bulletList")) editor.chain().focus().toggleBulletList().run(); break;
        case "todo": if (!editor.isActive("taskList")) editor.chain().focus().toggleTaskList().run(); break;
        case "quote": if (!editor.isActive("blockquote")) editor.chain().focus().toggleBlockquote().run(); break;
        default: editor.chain().focus().setParagraph().run();
      }
    } else {
      const blockEnd = $from.after();
      editor.chain().focus().insertContentAt(blockEnd, { type: "paragraph" }).setTextSelection(blockEnd + 1).run();
      switch (cmd.type) {
        case "heading1": editor.chain().focus().setHeading({ level: 1 }).run(); break;
        case "heading2": editor.chain().focus().setHeading({ level: 2 }).run(); break;
        case "heading3": editor.chain().focus().setHeading({ level: 3 }).run(); break;
        case "bulletList": editor.chain().focus().toggleBulletList().run(); break;
        case "todo": editor.chain().focus().toggleTaskList().run(); break;
        case "quote": editor.chain().focus().toggleBlockquote().run(); break;
        default: break;
      }
    }
  }

  function handlePlusSelect(cmd: (typeof SLASH_COMMANDS)[number]) {
    if (!editor) return;

    if (cmd.type === "image") {
      const { $from } = editor.state.selection;
      const parentEmpty = $from.parent.content.size === 0;
      if (parentEmpty) {
        const blockStart = $from.before();
        const blockEnd = $from.after();
        imageInsertPosRef.current = blockStart;
        editor.chain().deleteRange({ from: blockStart, to: blockEnd }).run();
      } else {
        const blockEnd = $from.after();
        editor.chain().insertContentAt(blockEnd, { type: "paragraph" }).run();
        imageInsertPosRef.current = blockEnd;
      }
      fileInputRef.current?.click();
    } else {
      applyBlockType(cmd);
    }

    // Ensure the editor keeps focus even when applyBlockType takes a no-op
    // branch (e.g. selecting "Bullet List" while already in one).
    editor.commands.focus();
    setShowPlusMenu(false);
  }

  return (
    <div ref={editorWrapRef} className="note-editor relative">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file) await insertImageFromFile(file);
          e.target.value = "";
        }}
      />
      <EditorContent editor={editor} />
      {/* Floating toolbars — rendered via portal so fixed positioning works */}
      {editable && createPortal(
        <FormatToolbar
          ref={linkInputRef}
          editor={editor}
          visible={showToolbar}
          linkMode={linkMode}
          linkUrl={linkUrl}
          formatTooltips={formatTooltips}
          linkTooltips={linkTooltips}
          onEnterLinkMode={enterLinkMode}
          onApplyLink={applyLink}
          onRemoveLink={removeLink}
          onLinkUrlChange={setLinkUrl}
          onExitLinkMode={() => {
            setLinkMode(false);
            setLinkUrl("");
            linkManualRef.current = false;
          }}
          onSetFormatTooltips={setFormatTooltips}
          onSetLinkTooltips={setLinkTooltips}
        />,
        document.body,
      )}

      {/* Block handle "+" button — always mounted (gated via `.hide`) so the
          opacity transition (150ms on `.drag-handle`) fades the icon in/out
          instead of snapping when handlePos appears/disappears. */}
      {editable && (
        <button
          ref={plusBtnRef}
          className={`drag-handle fixed border-none ${!handlePos || handleHidden || showPlusMenu || hasSelection ? "hide" : ""}`}
          style={{
            left: handlePos?.left ?? 0,
            top: handlePos?.top ?? 0,
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handlePlusClick();
          }}
        >
          <Plus className="w-4 h-4" strokeWidth={2} />
        </button>
      )}

      {/* Plus menu dropdown — portaled so it escapes NoteCard's stacking
          context (z-9999) and sits above every other UI layer. */}
      {editable && showPlusMenu && handlePos && createPortal(
        <PlusMenu
          ref={plusMenuRef}
          contentLeft={handlePos.contentLeft}
          lineBottom={handlePos.lineBottom}
          lineH={handlePos.lineH}
          flipUp={menuFlipUp}
          onSelect={handlePlusSelect}
          onClose={() => setShowPlusMenu(false)}
          onHoverItem={(i) => {
            plusIdxRef.current = i;
            highlightPlusItem();
          }}
        />,
        document.body,
      )}
    </div>
  );
}
