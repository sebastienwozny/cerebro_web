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
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Bold, Italic, Underline as UnderlineIcon, Strikethrough, Eraser, Link2, ExternalLink, Unlink, Check, Plus, Type, Heading1, Heading2, Heading3, List, ListChecks, Quote, ImageIcon } from "lucide-react";
import type { NoteBlock } from "../store/db";
import { blocksToHtml, htmlToBlocks } from "../lib/blockSerializer";
import { markdownToHtml, looksLikeMarkdown } from "../lib/markdownParser";
import { SLASH_COMMANDS, executeSlashCommand } from "../lib/slashCommands";
import { readImageFile } from "../lib/imageUtils";

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
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const slashIdxRef = useRef(0);
  const [showToolbar, setShowToolbar] = useState(false);
  const [linkMode, setLinkMode] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const linkInputRef = useRef<HTMLInputElement>(null);
  const linkManualRef = useRef(false);
  const [linkTooltips, setLinkTooltips] = useState(false);
  const [formatTooltips, setFormatTooltips] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInsertPosRef = useRef<number | null>(null);

  // Block handle ("+" button) — appears on hover next to the hovered block
  // Position is in viewport coordinates (position: fixed)
  const [handlePos, setHandlePos] = useState<{ top: number; left: number; contentLeft: number } | null>(null);
  const [handleBlockPos, setHandleBlockPos] = useState<number | null>(null);
  const [handleHidden, setHandleHidden] = useState(true);
  const [suppressHandles, setSuppressHandles] = useState(false);
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [menuFlipUp, setMenuFlipUp] = useState(false);
  const plusMenuRef = useRef<HTMLDivElement>(null);
  const plusBtnRef = useRef<HTMLButtonElement>(null);
  const plusIdxRef = useRef(0);
  const hoveredBlockRef = useRef<HTMLElement | null>(null);
  const computeFromBlockRef = useRef<((found: HTMLElement) => void) | null>(null);

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
      AutoJoiner,
    ],
    content: initialHtml.current,
    editable,
    onUpdate: ({ editor }) => {
      onUpdate(htmlToBlocks(editor as ReturnType<typeof useEditor>));
      hideSlashMenu();
    },
    onSelectionUpdate: ({ editor }) => {
      // Don't show the style toolbar for NodeSelection — that's what the
      // drag-handle extension creates when grabbing a block, and it would
      // flash the bar during a drag.
      const sel = !editor.state.selection.empty && !(editor.state.selection instanceof NodeSelection);
      if (sel) setShowToolbar(true);
      // Exit link mode when cursor moves off a link (unless manually opened)
      if (!editor.isActive("link") && !linkManualRef.current) {
        setLinkMode(false);
        setLinkUrl("");
      }
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
          enterLinkMode();
          return true;
        }
        if (event.key === "/" && slashMenuRef.current?.style.display !== "block") {
          setTimeout(() => showSlashMenu(), 0);
          return false;
        }
        if (slashMenuRef.current?.style.display === "block") {
          if (event.key === "Escape") {
            hideSlashMenu();
            return true;
          }
          if (event.key === "ArrowDown") {
            slashIdxRef.current = Math.min(slashIdxRef.current + 1, SLASH_COMMANDS.length - 1);
            highlightSlashItem();
            return true;
          }
          if (event.key === "ArrowUp") {
            slashIdxRef.current = Math.max(slashIdxRef.current - 1, 0);
            highlightSlashItem();
            return true;
          }
          if (event.key === "Enter") {
            handleSlashSelect(SLASH_COMMANDS[slashIdxRef.current]);
            return true;
          }
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
      // Paste / drop — insert at current cursor
      (editor.chain().focus() as any).setImage({ src: dataUrl, aspect }).run();
    }
  }

  function handleSlashSelect(cmd: (typeof SLASH_COMMANDS)[number]) {
    if (!editor) return;
    if (cmd.type === "image") {
      // Delete the "/" character
      const { from } = editor.state.selection;
      editor.chain().focus().deleteRange({ from: from - 1, to: from }).run();

      // If current block is now empty, remove it and save its position
      const { $from } = editor.state.selection;
      const parentEmpty = $from.parent.content.size === 0;
      if (parentEmpty) {
        const blockStart = $from.before();
        const blockEnd = $from.after();
        imageInsertPosRef.current = blockStart;
        editor.chain().deleteRange({ from: blockStart, to: blockEnd }).run();
      } else {
        imageInsertPosRef.current = editor.state.selection.from;
      }

      fileInputRef.current?.click();
    } else {
      executeSlashCommand(editor, cmd);
    }
    hideSlashMenu();
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

  // Click below content to insert empty lines
  useEffect(() => {
    if (!editor || !editable) return;
    const overlay = editor.view.dom.closest("[data-editor-overlay]");
    if (!overlay) return;
    const handleOverlayClick = (e: Event) => {
      const me = e as MouseEvent;
      const tiptap = editor.view.dom;
      const tiptapRect = tiptap.getBoundingClientRect();

      // Click in left/right margins — clear selection and close toolbars
      if (me.clientX < tiptapRect.left || me.clientX > tiptapRect.right) {
        editor.commands.blur();
        setShowToolbar(false);
        setLinkMode(false);
        setLinkUrl("");
        linkManualRef.current = false;
        return;
      }

      const lastChild = tiptap.lastElementChild as HTMLElement | null;
      const contentBottom = lastChild
        ? lastChild.getBoundingClientRect().bottom
        : tiptapRect.top;
      if (me.clientY <= contentBottom) return;
      setShowToolbar(false);
      setLinkMode(false);
      setLinkUrl("");
      linkManualRef.current = false;
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
    return () => overlay.removeEventListener("click", handleOverlayClick);
  }, [editor, editable]);

  useEffect(() => {
    if (linkMode) {
      linkInputRef.current?.focus();
      setLinkTooltips(false);
    } else {
      setFormatTooltips(false);
    }
  }, [linkMode]);

  function enterLinkMode() {
    if (!editor) return;
    const href = editor.isActive("link") ? editor.getAttributes("link").href || "" : "";
    setLinkUrl(href);
    setLinkMode(true);
    linkManualRef.current = true;
  }

  function applyLink() {
    if (!editor) return;
    const url = linkUrl.trim();
    if (url) {
      const href = /^https?:\/\//.test(url) ? url : `https://${url}`;
      editor.chain().focus().setLink({ href }).run();
    } else {
      editor.chain().focus().unsetLink().run();
    }
    setLinkMode(false);
    setShowToolbar(false);
    setLinkUrl("");
    linkManualRef.current = false;
  }

  function removeLink() {
    if (!editor) return;
    editor.chain().focus().unsetLink().run();
    setLinkMode(false);
    setShowToolbar(false);
    setLinkUrl("");
    linkManualRef.current = false;
  }

  function showSlashMenu() {
    const menu = slashMenuRef.current;
    if (!menu || !editor) return;
    slashIdxRef.current = 0;
    menu.style.display = "block";
    highlightSlashItem();
  }

  function hideSlashMenu() {
    const menu = slashMenuRef.current;
    if (menu) menu.style.display = "none";
  }

  function highlightSlashItem() {
    const menu = slashMenuRef.current;
    if (!menu) return;
    const items = menu.querySelectorAll("[data-slash-item]");
    items.forEach((el, i) => {
      (el as HTMLElement).classList.toggle("active", i === slashIdxRef.current);
    });
  }

  // ── Block handle ("+" button next to focused block) ──

  const editorWrapRef = useRef<HTMLDivElement>(null);

  // Show "+" button on hover — mirrors tiptap-extension-global-drag-handle's
  // detection + positioning logic so the two handles stay aligned.
  useEffect(() => {
    if (!editor || !editable) return;
    const tiptap = editor.view.dom as HTMLElement;
    const DRAG_WIDTH = 36; // must match GlobalDragHandle.configure({ dragHandleWidth })
    const SELECTORS = "li, p:not(:first-child), pre, blockquote, h1, h2, h3, h4, h5, h6";

    const computeFromBlock = (found: HTMLElement) => {
      const cs = getComputedStyle(found);
      const parsedLH = parseInt(cs.lineHeight, 10);
      const lineHeight = isNaN(parsedLH) ? parseInt(cs.fontSize, 10) * 1.2 : parsedLH;
      const paddingTop = parseInt(cs.paddingTop, 10) || 0;
      const rect = found.getBoundingClientRect();
      const top = rect.top + paddingTop + (lineHeight - 24) / 2;
      const dragLeft = rect.left - DRAG_WIDTH;
      const plusLeft = dragLeft - 24 - 4;
      let contentLeft = rect.left;
      if (found.matches("ul:not([data-type=taskList]) li, ol li")) {
        contentLeft = rect.left + 24;
      } else if (found.matches('ul[data-type="taskList"] li')) {
        contentLeft = rect.left + 26;
      }
      return { top, plusLeft, contentLeft, dragLeft };
    };

    const syncDragHandle = (dragLeft: number, top: number) => {
      requestAnimationFrame(() => {
        const parent = tiptap.parentElement;
        const dragEl = parent?.querySelector(
          ".drag-handle[data-drag-handle]",
        ) as HTMLElement | null;
        if (dragEl) {
          dragEl.style.left = `${dragLeft}px`;
          dragEl.style.top = `${top}px`;
        }
      });
    };

    computeFromBlockRef.current = (found: HTMLElement) => {
      const { top, plusLeft, contentLeft, dragLeft } = computeFromBlock(found);
      setHandlePos({ top, left: plusLeft, contentLeft });
      syncDragHandle(dragLeft, top);
    };

    const onMove = (e: MouseEvent) => {
      if (showPlusMenu || suppressHandles) return;
      const probeX = e.clientX + 50 + DRAG_WIDTH;
      const probeY = e.clientY;
      const found = document
        .elementsFromPoint(probeX, probeY)
        .find((el) => {
          // Skip list containers — we want the <li>, not the whole <ul>/<ol>.
          // (ul/ol are direct children of the editor root, so the generic
          // `parentElement === tiptap` check below would otherwise match them.)
          if (el.matches("ul, ol")) return false;
          return el.parentElement === tiptap || el.matches(SELECTORS);
        }) as HTMLElement | undefined;
      if (!found) return;

      hoveredBlockRef.current = found;
      const { top, plusLeft, contentLeft, dragLeft } = computeFromBlock(found);
      setHandlePos({ top, left: plusLeft, contentLeft });
      syncDragHandle(dragLeft, top);

      const result = editor.view.posAtCoords({ left: probeX, top: probeY });
      if (result) {
        const $p = editor.state.doc.resolve(result.pos);
        setHandleBlockPos($p.end());
      }
    };

    // Left-margin handler: window-level listener gated to the narrow band
    // immediately to the left of tiptap so hovering in that gutter (outside
    // tiptap) also triggers the handles for the row at cursor y.
    const MARGIN_BAND = 120; // px to the left of tiptap where handles react
    const onMarginMove = (e: MouseEvent) => {
      if (showPlusMenu || suppressHandles) return;
      const tiptapRect = tiptap.getBoundingClientRect();
      if (e.clientX >= tiptapRect.left) return; // right of tiptap → onMove handles it
      if (e.clientX < tiptapRect.left - MARGIN_BAND) return;
      if (e.clientY < tiptapRect.top || e.clientY > tiptapRect.bottom) return;

      const probeX = tiptapRect.left + 20;
      const probeY = e.clientY;
      const found = document
        .elementsFromPoint(probeX, probeY)
        .find((el) => {
          if (el.matches("ul, ol")) return false;
          return el.parentElement === tiptap || el.matches(SELECTORS);
        }) as HTMLElement | undefined;
      if (!found) return;

      hoveredBlockRef.current = found;
      const { top, plusLeft, contentLeft, dragLeft } = computeFromBlock(found);
      setHandlePos({ top, left: plusLeft, contentLeft });
      syncDragHandle(dragLeft, top);
      // Extension hides its drag handle on tiptap mouseout; force-show while
      // we're anchored to a block in the margin band.
      requestAnimationFrame(() => {
        const dragEl = tiptap.parentElement?.querySelector(
          ".drag-handle[data-drag-handle]",
        ) as HTMLElement | null;
        dragEl?.classList.remove("hide");
      });

      const result = editor.view.posAtCoords({ left: probeX, top: probeY });
      if (result) {
        const $p = editor.state.doc.resolve(result.pos);
        setHandleBlockPos($p.end());
      }
    };

    tiptap.addEventListener("mousemove", onMove);
    window.addEventListener("mousemove", onMarginMove);
    return () => {
      tiptap.removeEventListener("mousemove", onMove);
      window.removeEventListener("mousemove", onMarginMove);
    };
  }, [editor, editable, showPlusMenu, suppressHandles]);

  // Keep the menu anchored to the hovered block when any ancestor scrolls or on resize.
  useEffect(() => {
    if (!showPlusMenu) return;
    const update = () => {
      const block = hoveredBlockRef.current;
      if (!block || !block.isConnected) return;
      computeFromBlockRef.current?.(block);
    };
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [showPlusMenu]);

  // Flip menu above the line when it would overflow the viewport bottom.
  useLayoutEffect(() => {
    if (!showPlusMenu || !handlePos) return;
    const el = plusMenuRef.current;
    if (!el) return;
    const h = el.offsetHeight;
    const viewportH = window.innerHeight;
    setMenuFlipUp(handlePos.top + h > viewportH - 8);
  }, [showPlusMenu, handlePos]);

  // Reset suppression when mouse leaves the editor area so handles come back on re-entry
  useEffect(() => {
    if (!editor || !editable) return;
    const wrap = editorWrapRef.current;
    if (!wrap) return;
    const onLeave = () => setSuppressHandles(false);
    wrap.addEventListener("mouseleave", onLeave);
    return () => wrap.removeEventListener("mouseleave", onLeave);
  }, [editor, editable]);

  // Force-hide the extension's drag handle while suppressed or while the "+" menu is open
  useEffect(() => {
    const parent = editor?.view.dom.parentElement;
    const dragEl = parent?.querySelector(".drag-handle[data-drag-handle]") as HTMLElement | null;
    if (!dragEl) return;
    if (suppressHandles || showPlusMenu) {
      dragEl.style.opacity = "0";
      dragEl.style.pointerEvents = "none";
    } else {
      dragEl.style.opacity = "";
      dragEl.style.pointerEvents = "";
    }
  }, [suppressHandles, showPlusMenu, editor]);

  // Mirror the drag handle's `hide` class onto our "+" so both fade together
  useEffect(() => {
    if (!editor || !editable) return;
    let observer: MutationObserver | null = null;
    let cancelled = false;
    const attach = () => {
      if (cancelled) return;
      const parent = editor.view.dom.parentElement;
      const dragEl = parent?.querySelector(".drag-handle[data-drag-handle]");
      if (!dragEl) {
        requestAnimationFrame(attach);
        return;
      }
      const sync = () => setHandleHidden(dragEl.classList.contains("hide"));
      sync();
      observer = new MutationObserver(sync);
      observer.observe(dragEl, { attributes: true, attributeFilter: ["class"] });
    };
    attach();
    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [editor, editable]);

  // Close plus menu on click outside or Escape
  useEffect(() => {
    if (!showPlusMenu) return;
    const onClick = (e: MouseEvent) => {
      if (plusMenuRef.current?.contains(e.target as Node)) return;
      if (plusBtnRef.current?.contains(e.target as Node)) return;
      setShowPlusMenu(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); setShowPlusMenu(false); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); plusIdxRef.current = Math.min(plusIdxRef.current + 1, SLASH_COMMANDS.length - 1); highlightPlusItem(); }
      if (e.key === "ArrowUp") { e.preventDefault(); plusIdxRef.current = Math.max(plusIdxRef.current - 1, 0); highlightPlusItem(); }
      if (e.key === "Enter") { e.preventDefault(); handlePlusSelect(SLASH_COMMANDS[plusIdxRef.current]); }
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
  }, [showPlusMenu]);

  function highlightPlusItem() {
    const menu = plusMenuRef.current;
    if (!menu) return;
    menu.querySelectorAll("[data-plus-item]").forEach((el, i) => {
      (el as HTMLElement).classList.toggle("active", i === plusIdxRef.current);
    });
  }

  function handlePlusClick() {
    if (!editor) return;
    // Move selection into the hovered block so the menu acts on that block
    if (handleBlockPos !== null) {
      editor.chain().focus().setTextSelection(handleBlockPos).run();
    }
    // If current line has content, insert a new empty line below and move cursor there
    const { $from } = editor.state.selection;
    const parentEmpty = $from.parent.content.size === 0;
    if (!parentEmpty) {
      // Detect if we're inside a list/task item so we create a new item rather than a second paragraph within the same item
      let liType: "listItem" | "taskItem" | null = null;
      for (let d = $from.depth; d > 0; d--) {
        const name = $from.node(d).type.name;
        if (name === "listItem" || name === "taskItem") { liType = name; break; }
      }
      if (liType) {
        editor.chain().focus().splitListItem(liType).run();
      } else {
        const blockEnd = $from.after();
        editor.chain().focus().insertContentAt(blockEnd, { type: "paragraph" }).setTextSelection(blockEnd + 1).run();
      }
      // Re-anchor "+" (and dropdown) to the newly inserted line
      try {
        const coords = editor.view.coordsAtPos(editor.state.selection.$from.pos);
        const top = coords.top + (coords.bottom - coords.top - 24) / 2;
        setHandlePos((prev) => (prev ? { ...prev, top } : null));
        // Update hovered block ref so scroll-tracking follows the new line
        const dom = editor.view.domAtPos(editor.state.selection.$from.pos).node;
        const el = (dom instanceof HTMLElement ? dom : dom.parentElement) as HTMLElement | null;
        if (el) {
          const blockEl = el.closest("li, p, pre, blockquote, h1, h2, h3, h4, h5, h6") as HTMLElement | null;
          if (blockEl) hoveredBlockRef.current = blockEl;
        }
      } catch { /* noop */ }
    }
    plusIdxRef.current = 0;
    setShowPlusMenu((v) => !v);
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
        case "bulletList": editor.chain().focus().toggleBulletList().run(); break;
        case "todo": editor.chain().focus().toggleTaskList().run(); break;
        case "quote": editor.chain().focus().toggleBlockquote().run(); break;
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

    setShowPlusMenu(false);
    setSuppressHandles(true);
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
      <div ref={slashMenuRef} className="slash-menu" style={{ display: "none" }}>
        {SLASH_COMMANDS.map((cmd, i) => (
          <div
            key={cmd.type}
            data-slash-item
            className={`slash-menu-item ${i === 0 ? "active" : ""}`}
            onMouseDown={(e) => {
              e.preventDefault();
              handleSlashSelect(cmd);
            }}
            onMouseEnter={() => {
              slashIdxRef.current = i;
              highlightSlashItem();
            }}
          >
            {cmd.label}
          </div>
        ))}
      </div>
      {/* Floating toolbars — rendered via portal so fixed positioning works */}
      {editable && createPortal(
        <>
          {/* Format bar */}
          <div
            className={`fixed left-1/2 -translate-x-1/2 flex items-center gap-1 p-1.5 backdrop-blur-xl rounded-xl border border-white/8 transition-all duration-300 ${(showToolbar || linkMode) && !linkMode ? "ease-[cubic-bezier(0,0,0.35,1)] bottom-10 scale-100 opacity-100" : "ease-[cubic-bezier(0.65,0,1,1)] -bottom-24 scale-80 opacity-0"}`}
            style={{ zIndex: 10002, background: "#1a1c1e", pointerEvents: (showToolbar && !linkMode) ? "auto" : "none", boxShadow: "0 -10px 40px -10px rgba(0,0,0,0.15), 0 20px 25px -5px rgba(0,0,0,0.3), 0 8px 10px -6px rgba(0,0,0,0.3), 0 40px 80px -20px rgba(0,0,0,0.25), 0 70px 140px -30px rgba(0,0,0,0.2), 0 120px 240px -40px rgba(0,0,0,0.15)" }}
          >
            {[
              { icon: Bold, label: "Bold", cmd: () => editor?.chain().focus().toggleBold().run(), active: editor?.isActive("bold"), shortcut: "⌘B" },
              { icon: Italic, label: "Italic", cmd: () => editor?.chain().focus().toggleItalic().run(), active: editor?.isActive("italic"), shortcut: "⌘I" },
              { icon: UnderlineIcon, label: "Underline", cmd: () => editor?.chain().focus().toggleUnderline().run(), active: editor?.isActive("underline"), shortcut: "⌘U" },
              { icon: Strikethrough, label: "Strikethrough", cmd: () => editor?.chain().focus().toggleStrike().run(), active: editor?.isActive("strike"), shortcut: "⌘⇧X" },
              { icon: Link2, label: "Link", cmd: () => enterLinkMode(), active: editor?.isActive("link"), shortcut: "⌘K" },
            ].map(({ icon: Icon, label, cmd, active, shortcut }, i) => (
              <div key={i} className="relative group flex flex-col items-center transition-transform duration-120 ease-out hover:scale-108" onMouseLeave={() => setFormatTooltips(true)}>
                <button
                  onMouseDown={(e) => { e.preventDefault(); cmd(); }}
                  className={`w-10 h-10 rounded-lg flex items-center justify-center border-none cursor-pointer select-none transition-colors duration-150 ${active ? "text-white bg-[#333] dark:bg-neutral-800" : "text-neutral-300 bg-transparent hover:bg-[#333] hover:text-white dark:hover:bg-neutral-800"}`}
                >
                  <Icon className="w-4 h-[18px]" strokeWidth={2.5} />
                </button>
                <div className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-3 px-2 py-1 rounded-lg text-[9px] font-semibold uppercase whitespace-nowrap opacity-0 ${formatTooltips ? "group-hover:opacity-100" : ""} pointer-events-none transition-opacity duration-150 shadow-lg bg-neutral-800 text-white/90 border border-white/8 flex items-center gap-2`}>
                  <span>{label}</span>
                  <span className="text-white/60">{shortcut}</span>
                </div>
              </div>
            ))}
            <div className="relative group flex flex-col items-center transition-transform duration-120 ease-out hover:scale-110" onMouseLeave={() => setFormatTooltips(true)}>
              <button
                onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().unsetAllMarks().run(); }}
                className="w-10 h-10 rounded-lg flex items-center justify-center border-none cursor-pointer select-none text-neutral-300 bg-transparent hover:bg-[#333] hover:text-white dark:hover:bg-neutral-800 transition-colors duration-150"
              >
                <Eraser className="w-4 h-[18px]" strokeWidth={2.5} />
              </button>
              <div className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-3 px-2 py-1 rounded-lg text-[9px] font-semibold uppercase whitespace-nowrap opacity-0 ${formatTooltips ? "group-hover:opacity-100" : ""} pointer-events-none transition-opacity duration-150 shadow-lg bg-neutral-800 text-white/90 border border-white/8`}>
                Clear
              </div>
            </div>
          </div>
          {/* Link bar */}
          <div
            className={`fixed left-1/2 -translate-x-1/2 flex items-center gap-1 p-1.5 backdrop-blur-xl rounded-xl border border-white/8 transition-all duration-300 ${linkMode ? "ease-[cubic-bezier(0,0,0.35,1)] bottom-10 scale-100 opacity-100" : "ease-[cubic-bezier(0.65,0,1,1)] -bottom-24 scale-80 opacity-0"}`}
            style={{ zIndex: 10002, background: "#1a1c1e", pointerEvents: linkMode ? "auto" : "none", boxShadow: "0 -10px 40px -10px rgba(0,0,0,0.15), 0 20px 25px -5px rgba(0,0,0,0.3), 0 8px 10px -6px rgba(0,0,0,0.3), 0 40px 80px -20px rgba(0,0,0,0.25), 0 70px 140px -30px rgba(0,0,0,0.2), 0 120px 240px -40px rgba(0,0,0,0.15)" }}
          >
            <input
              ref={linkInputRef}
              type="text"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); applyLink(); }
                if (e.key === "Escape") { e.preventDefault(); setLinkMode(false); setLinkUrl(""); linkManualRef.current = false; editor?.commands.focus(); }
              }}
              placeholder="Paste link..."
              className="h-10 px-3 bg-transparent border-none outline-none text-sm text-white placeholder-neutral-500"
              style={{ width: 220 }}
            />
            {[
              { icon: Check, label: "Apply", cmd: () => applyLink() },
              { icon: ExternalLink, label: "Open", cmd: () => { if (linkUrl.trim()) { const href = /^https?:\/\//.test(linkUrl.trim()) ? linkUrl.trim() : `https://${linkUrl.trim()}`; window.open(href, "_blank"); } } },
              { icon: Unlink, label: "Unlink", cmd: () => removeLink() },
            ].map(({ icon: Icon, label, cmd }, i) => (
              <div key={i} className="relative group flex flex-col items-center transition-transform duration-120 ease-out hover:scale-108" onMouseLeave={() => setLinkTooltips(true)}>
                <button
                  onMouseDown={(e) => { e.preventDefault(); cmd(); }}
                  className="w-10 h-10 rounded-lg flex items-center justify-center border-none cursor-pointer select-none text-neutral-300 bg-transparent hover:bg-[#333] hover:text-white dark:hover:bg-neutral-800 transition-colors duration-150"
                >
                  <Icon className="w-4 h-[18px]" strokeWidth={2.5} />
                </button>
                <div className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-3 px-2 py-1 rounded-lg text-[9px] font-semibold uppercase whitespace-nowrap opacity-0 ${linkTooltips ? "group-hover:opacity-100" : ""} pointer-events-none transition-opacity duration-150 shadow-lg bg-neutral-800 text-white/90 border border-white/8`}>
                  {label}
                </div>
              </div>
            ))}
          </div>

        </>,
        document.body,
      )}

      {/* Block handle "+" button — viewport-positioned next to the hovered block */}
      {editable && handlePos && (
        <button
          ref={plusBtnRef}
          className={`drag-handle ${handleHidden || suppressHandles || showPlusMenu ? "hide" : ""}`}
          style={{
            position: "fixed",
            left: handlePos.left,
            top: handlePos.top,
            border: "none",
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

      {/* Plus menu dropdown */}
      {editable && showPlusMenu && handlePos && (
        <div
          ref={plusMenuRef}
          className="flex flex-col py-1.5 backdrop-blur-xl rounded-xl border border-white/8"
          style={{
            position: "fixed",
            zIndex: 10003,
            left: handlePos.contentLeft,
            top: handlePos.top,
            transform: menuFlipUp ? "translateY(-100%)" : undefined,
            background: "#1a1c1e",
            boxShadow: "0 20px 25px -5px rgba(0,0,0,0.3), 0 8px 10px -6px rgba(0,0,0,0.3), 0 40px 80px -20px rgba(0,0,0,0.25)",
            minWidth: 220,
          }}
        >
          {SLASH_COMMANDS.map((cmd, i) => {
            const meta = {
              text:      { icon: Type,       shortcut: "" },
              heading1:  { icon: Heading1,   shortcut: "#" },
              heading2:  { icon: Heading2,   shortcut: "##" },
              heading3:  { icon: Heading3,   shortcut: "###" },
              bulletList:{ icon: List,        shortcut: "-" },
              todo:      { icon: ListChecks,  shortcut: "[]" },
              quote:     { icon: Quote,       shortcut: ">" },
              image:     { icon: ImageIcon,   shortcut: "/image" },
            }[cmd.type] ?? { icon: Type, shortcut: "" };
            const Icon = meta.icon;
            return (
              <button
                key={cmd.type}
                data-plus-item
                className={`flex items-center gap-3 px-3 py-2 mx-1.5 rounded-lg border-none cursor-pointer select-none transition-colors duration-100 text-neutral-300 hover:bg-white/8 hover:text-white ${i === 0 ? "bg-white/8 text-white" : ""}`}
                style={{ background: i === 0 ? undefined : "transparent" }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handlePlusSelect(cmd);
                }}
                onMouseEnter={() => {
                  plusIdxRef.current = i;
                  highlightPlusItem();
                }}
              >
                <Icon className="w-4 h-4 shrink-0" strokeWidth={2} />
                <span className="text-[13px] flex-1 text-left">{cmd.label}</span>
                {meta.shortcut && (
                  <span className="text-[11px] text-white/40 ml-4 font-semibold tracking-wide">{meta.shortcut}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
