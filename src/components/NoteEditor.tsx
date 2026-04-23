import { useEditor, EditorContent } from "@tiptap/react";
import { DOMParser } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import { createPortal } from "react-dom";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Underline from "@tiptap/extension-underline";
import GlobalDragHandle from "tiptap-extension-global-drag-handle";
import AutoJoiner from "tiptap-extension-auto-joiner";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useBlockHandle } from "../hooks/useBlockHandle";
import { useLinkMode } from "../hooks/useLinkMode";
import { useEditorDragScroll } from "../hooks/useEditorDragScroll";
import { Plus } from "lucide-react";
import type { NoteBlock } from "../store/db";
import { blocksToHtml, htmlToBlocks } from "../lib/blockSerializer";
import { markdownToHtml, looksLikeMarkdown } from "../lib/markdownParser";
import { BLOCK_DEFS, type BlockDef } from "../lib/blockRegistry";
import { readImageFile } from "../lib/imageUtils";
import { readVideoFile, VideoTooLargeError } from "../lib/videoUtils";
import { getVideoUrl } from "../lib/videoUrlCache";
import { CodeBlockWithView, ImageWithAspect, VideoBlock } from "../lib/editor/extensions";
import FormatToolbar from "./FormatToolbar";
import PlusMenu from "./PlusMenu";

interface Props {
  blocks: NoteBlock[];
  onUpdate: (blocks: NoteBlock[]) => void;
  editable: boolean;
}

export default function NoteEditor({ blocks, onUpdate, editable }: Props) {
  // Block-id → Blob map is local (used by the HTML→block serializer to reattach
  // blobs on save). URLs come from a module-level cache so StrictMode's double
  // effect cycle can't revoke them out from under the editor.
  const videoBlobsRef = useRef<Map<string, Blob>>(new Map());
  const videoUrlsRef = useRef<Map<string, string>>(new Map());
  for (const b of blocks) {
    if (b.type === "video" && b.videoBlob && !videoBlobsRef.current.has(b.id)) {
      videoBlobsRef.current.set(b.id, b.videoBlob);
      videoUrlsRef.current.set(b.id, getVideoUrl(b.id, b.videoBlob));
    }
  }

  const initialHtml = useRef(blocksToHtml(blocks, videoUrlsRef.current));
  const [showToolbar, setShowToolbar] = useState(false);
  const [formatTooltips, setFormatTooltips] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const imageInsertPosRef = useRef<number | null>(null);
  const videoInsertPosRef = useRef<number | null>(null);

  const [hasSelection, setHasSelection] = useState(false);
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [menuFlipUp, setMenuFlipUp] = useState(false);
  const [frozenMenuPos, setFrozenMenuPos] = useState<{ contentLeft: number; lineBottom: number; lineH: number } | null>(null);
  const menuPosFrozen = useRef(false);
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
        codeBlock: false,
      }),
      CodeBlockWithView,
      Placeholder.configure({
        placeholder: ({ node }) => {
          if (node.type.name === "heading") return "Untitled";
          // Code blocks have their own language picker / copy UI — no hint needed.
          if (node.type.name === "codeBlock") return "";
          return "Press '/' for commands";
        },
        showOnlyCurrent: true,
        includeChildren: true,
      }),
      TaskList,
      TaskItem.configure({ nested: false }),
      ImageWithAspect.configure({ inline: false, allowBase64: true }),
      VideoBlock,
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
      onUpdate(htmlToBlocks(editor as ReturnType<typeof useEditor>, videoBlobsRef.current));
    },
    onSelectionUpdate: ({ editor }) => {
      // Don't show the style toolbar for NodeSelection — that's what the
      // drag-handle extension creates when grabbing a block, and it would
      // flash the bar during a drag.
      const sel = !editor.state.selection.empty && !(editor.state.selection instanceof NodeSelection);
      setHasSelection(sel);
      // Selections inside a code block shouldn't get the prose format bar —
      // bold/italic/link don't apply to raw code.
      setShowToolbar(sel && !editor.isActive("codeBlock"));
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
        const videoItem = items.find(item => item.type.startsWith("video/"));
        if (videoItem) {
          const file = videoItem.getAsFile();
          if (file) {
            event.preventDefault();
            insertVideoFromFile(file);
            return true;
          }
        }

        const text = event.clipboardData?.getData("text/plain");
        const { $from } = view.state.selection;

        // Inside a code block, always use text/plain. TipTap's default paste
        // parses clipboard text/html, and the browser's HTML parser normalizes
        // whitespace between sibling block tags — so pasting e.g. indented
        // HTML/JSX would lose newlines that aren't immediately adjacent to
        // text content. text/plain preserves the raw clipboard text as-is.
        if ($from.parent.type.name === "codeBlock" && text) {
          event.preventDefault();
          const tr = view.state.tr.insertText(text);
          view.dispatch(tr);
          requestAnimationFrame(() => {
            if (scrollEl) scrollEl.scrollTop = scrollTop;
          });
          return true;
        }

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
        const imgFile = Array.from(dt.files).find(f => f.type.startsWith("image/"));
        if (imgFile) {
          event.preventDefault();
          insertImageFromFile(imgFile);
          return true;
        }
        const videoFile = Array.from(dt.files).find(f => f.type.startsWith("video/"));
        if (videoFile) {
          event.preventDefault();
          insertVideoFromFile(videoFile);
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
          const { $from } = editor.state.selection;
          if ($from.parentOffset !== 0) return false;
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

  async function insertVideoFromFile(file: File) {
    if (!editor) return;
    let result;
    try {
      result = await readVideoFile(file);
    } catch (err) {
      if (err instanceof VideoTooLargeError) {
        alert("Video is larger than 500 MB and cannot be imported.");
      } else {
        alert("Couldn't decode this video file.");
      }
      return;
    }
    const { blob, posterDataUrl, aspect, mimeType } = result;
    const blockId = crypto.randomUUID();
    const url = getVideoUrl(blockId, blob);
    videoBlobsRef.current.set(blockId, blob);
    videoUrlsRef.current.set(blockId, url);

    const attrs = { src: url, blockId, poster: posterDataUrl, aspect, mimeType };
    const pos = videoInsertPosRef.current;
    videoInsertPosRef.current = null;

    if (pos !== null) {
      editor.chain().focus()
        .insertContentAt(pos, { type: "video", attrs })
        .run();
    } else {
      editor.chain().focus()
        .insertContent({ type: "video", attrs })
        .run();
    }
  }

  useEffect(() => {
    if (editor) {
      editor.setEditable(editable);
      if (editable) {
        const firstType = editor.getJSON().content?.[0]?.type;
        const hasHeaderImage = firstType === "image" || firstType === "video";
        if (hasHeaderImage) {
          // Collapse any NodeSelection before blurring — without this the
          // header image stays marked .ProseMirror-selectednode on open.
          editor.chain().setTextSelection(0).blur().run();
        } else {
          editor.commands.setTextSelection(0);
          (editor.view.dom as HTMLElement).focus({ preventScroll: true });
        }
      }
    }
  }, [editor, editable]);

  useEditorDragScroll(editor, editable);

  useEffect(() => {
    if (!editor || !editable) return;
    const onDelete = () => {
      const firstNode = editor.state.doc.firstChild;
      if (firstNode?.type.name !== "video") return;
      editor.chain().setNodeSelection(0).deleteSelection().focus(undefined, { scrollIntoView: false }).run();
    };
    window.addEventListener("pvp-header-delete", onDelete);
    return () => window.removeEventListener("pvp-header-delete", onDelete);
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
            // Collapse to `.to` — the position right after the node. Using
            // `.from` (right before) lands TextSelection.near() *inside*
            // code blocks, which re-selects them instead of deselecting.
            editor.commands.setTextSelection(editor.state.selection.to);
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

  // Drop format-bar tooltips only when link mode *exits* (true → false), so
  // hovering the bar right after closing the link input doesn't flash
  // tooltips at the user's cursor. Re-enable whenever the toolbar hides, so
  // the next selection starts with tooltips available on first hover.
  const prevLinkMode = useRef(linkMode);
  useEffect(() => {
    if (prevLinkMode.current && !linkMode) setFormatTooltips(false);
    prevLinkMode.current = linkMode;
  }, [linkMode]);
  useEffect(() => {
    if (!showToolbar) setFormatTooltips(true);
  }, [showToolbar]);

  // ── Block handle ("+" button next to focused block) ──
  const {
    handlePos, handleBlockPos, handleHidden,
    editorWrapRef, plusBtnRef, hoveredBlockRef, computeFromBlockRef,
  } = useBlockHandle({ editor, editable, showPlusMenu, hasSelection, plusMenuRef });

  // Freeze position + flip direction once when menu opens.
  useLayoutEffect(() => {
    if (!showPlusMenu) { menuPosFrozen.current = false; setFrozenMenuPos(null); return; }
    if (!handlePos || menuPosFrozen.current) return;
    const el = plusMenuRef.current;
    if (!el) return;
    const overlay = editor?.view.dom.closest("[data-editor-overlay]") as HTMLElement | null;
    const scrollTop = overlay?.scrollTop ?? 0;
    const h = el.offsetHeight;
    const viewportH = window.innerHeight;
    setMenuFlipUp(handlePos.lineBottom + 8 + h > viewportH - 8);
    setFrozenMenuPos({
      contentLeft: handlePos.contentLeft,
      lineBottom: handlePos.lineBottom + scrollTop,
      lineH: handlePos.lineH,
    });
    menuPosFrozen.current = true;
  }, [showPlusMenu, handlePos, editor]);

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
      // Close button is the last item (index === BLOCK_DEFS.length).
      const maxIdx = BLOCK_DEFS.length;
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
        else handlePlusSelect(BLOCK_DEFS[plusIdxRef.current]);
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

  function applyBlockType(def: BlockDef) {
    if (!editor) return;
    const { $from } = editor.state.selection;
    const parentEmpty = $from.parent.content.size === 0;

    if (!parentEmpty) {
      const blockEnd = $from.after();
      editor.chain().focus().insertContentAt(blockEnd, { type: "paragraph" }).setTextSelection(blockEnd + 1).run();
    }
    def.apply?.(editor);
  }

  function handlePlusSelect(def: BlockDef) {
    if (!editor) return;

    if (def.type === "image" || def.type === "video") {
      const { $from } = editor.state.selection;
      const parentEmpty = $from.parent.content.size === 0;
      let insertPos: number;
      if (parentEmpty) {
        const blockStart = $from.before();
        const blockEnd = $from.after();
        insertPos = blockStart;
        editor.chain().deleteRange({ from: blockStart, to: blockEnd }).run();
      } else {
        const blockEnd = $from.after();
        editor.chain().insertContentAt(blockEnd, { type: "paragraph" }).run();
        insertPos = blockEnd;
      }
      if (def.type === "image") {
        imageInsertPosRef.current = insertPos;
        fileInputRef.current?.click();
      } else {
        videoInsertPosRef.current = insertPos;
        videoInputRef.current?.click();
      }
    } else {
      applyBlockType(def);
    }

    // Ensure the editor keeps focus even when apply takes a no-op branch
    // (e.g. selecting "Bullet List" while already in one).
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
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file) await insertVideoFromFile(file);
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
          onExitLinkMode={exitLinkMode}
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

      {/* Plus menu — portaled into the editor scroll container so it uses
          position:absolute in document-space. The browser then handles scroll
          tracking natively with zero JS lag. */}
      {editable && showPlusMenu && handlePos && (() => {
        const overlay = editor?.view.dom.closest("[data-editor-overlay]") as HTMLElement | null;
        if (!overlay) return null;
        const pos = frozenMenuPos ?? { contentLeft: handlePos.contentLeft, lineBottom: handlePos.lineBottom + overlay.scrollTop, lineH: handlePos.lineH };
        return createPortal(
          <PlusMenu
            ref={plusMenuRef}
            contentLeft={pos.contentLeft}
            lineBottom={pos.lineBottom}
            lineH={pos.lineH}
            flipUp={menuFlipUp}
            onSelect={handlePlusSelect}
            onClose={() => setShowPlusMenu(false)}
            onHoverItem={(i) => {
              plusIdxRef.current = i;
              highlightPlusItem();
            }}
          />,
          overlay,
        );
      })()}
    </div>
  );
}
