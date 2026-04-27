import { useEditor, EditorContent } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import { DOMParser, DOMSerializer } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import { createPortal } from "react-dom";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import GlobalDragHandle from "tiptap-extension-global-drag-handle";
import AutoJoiner from "tiptap-extension-auto-joiner";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useBlockHandle } from "../hooks/useBlockHandle";
import { useLinkMode } from "../hooks/useLinkMode";
import { useLinkHoverPopup } from "../hooks/useLinkHoverPopup";
import { useEditorDragScroll } from "../hooks/useEditorDragScroll";
import type { NoteBlock } from "../store/db";
import { blocksToHtml, htmlToBlocks } from "../lib/blockSerializer";
import { markdownToHtml, looksLikeMarkdown } from "../lib/markdownParser";
import { BLOCK_DEFS, type BlockDef } from "../lib/blockRegistry";
import { readImageFile } from "../lib/imageUtils";
import { readVideoFile, VideoTooLargeError } from "../lib/videoUtils";
import { getVideoUrl } from "../lib/videoUrlCache";
import { CodeBlockWithView, ImageWithAspect, VideoBlock } from "../lib/editor/extensions";
import FormatToolbar from "./FormatToolbar";
import MediaToolbar from "./MediaToolbar";
import PlusMenu from "./PlusMenu";
import BlockMenu from "./BlockMenu";
import { v4 as uuidv4 } from "uuid";
import { setMediaClipboard, clearMediaClipboard } from "../store/mediaClipboard";

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
  // Image blob round-trip map. Same purpose as videoBlobsRef but stores
  // both the display + HD-original blobs (and their MIME types) so the
  // serializer can reattach them on save.
  const imageBlobsRef = useRef<Map<string, { display?: Blob; original?: Blob; mimeType?: string; mimeTypeOriginal?: string }>>(new Map());
  // Debounce timer for the editor's onUpdate save. Cleared+flushed on unmount.
  const saveTimerRef = useRef<number | null>(null);
  for (const b of blocks) {
    if (b.type === "video" && b.videoBlob && !videoBlobsRef.current.has(b.id)) {
      videoBlobsRef.current.set(b.id, b.videoBlob);
      videoUrlsRef.current.set(b.id, getVideoUrl(b.id, b.videoBlob));
    }
    if (b.type === "image" && b.imageBlob && !imageBlobsRef.current.has(b.id)) {
      imageBlobsRef.current.set(b.id, {
        display: b.imageBlob,
        original: b.imageBlobOriginal,
        mimeType: b.imageMimeType,
        mimeTypeOriginal: b.imageMimeTypeOriginal,
      });
    }
  }

  const initialHtml = useRef(blocksToHtml(blocks, videoUrlsRef.current));
  const [showToolbar, setShowToolbar] = useState(false);
  const [formatTooltips, setFormatTooltips] = useState(true);
  const [showMediaToolbar, setShowMediaToolbar] = useState(false);
  const [mediaTooltips, setMediaTooltips] = useState(true);
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

  const [showBlockMenu, setShowBlockMenu] = useState(false);
  const [blockMenuPos, setBlockMenuPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const blockMenuBlockPosRef = useRef<number | null>(null);
  const handleBlockPosRef = useRef<number | null>(null);

  // Link-mode handlers are bound to useLinkMode's callbacks below; we refer to
  // them via refs inside useEditor's config so the (once-evaluated) handlers
  // can reach the latest version without recreating the editor.
  const enterLinkModeRef = useRef<() => void>(() => {});
  const linkOnSelectionChangeRef = useRef<(isLinkActive: boolean) => void>(() => {});

  // Flush any pending debounced save when the editor unmounts (card closes)
  // so the last keystrokes aren't lost.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        if (editorRef.current) {
          onUpdate(htmlToBlocks(editorRef.current, videoBlobsRef.current, imageBlobsRef.current));
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const editorRef = useRef<ReturnType<typeof useEditor> | null>(null);

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
      GlobalDragHandle.configure({
        dragHandleWidth: 36,
        scrollTreshold: 100,
      }),
      AutoJoiner.configure({
        elementsToJoin: ["bulletList", "orderedList", "taskList"],
      }),
      // Prevent undoInputRule from reverting a divider back to "---" when the
      // user presses Backspace on the empty paragraph that follows it. We just
      // delete that empty paragraph instead.
      Extension.create({
        name: "hrBackspaceFix",
        addKeyboardShortcuts() {
          return {
            Backspace: () => {
              const { state } = this.editor;
              const { $anchor, empty } = state.selection;
              if (!empty || $anchor.parentOffset !== 0) return false;
              if ($anchor.parent.type.name !== "paragraph" || $anchor.parent.childCount !== 0) return false;
              const $beforePara = state.doc.resolve($anchor.before());
              if ($beforePara.nodeBefore?.type.name !== "horizontalRule") return false;
              return this.editor.commands.deleteCurrentNode();
            },
          };
        },
      }),
    ],
    content: initialHtml.current,
    editable,
    onUpdate: ({ editor }) => {
      // Debounced save: keystrokes batch into a single Dexie write. Without
      // this, every key fires htmlToBlocks + db.notes.update, which makes
      // useLiveQuery re-fetch every note (blobs included) on each keystroke.
      if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        onUpdate(htmlToBlocks(editor as ReturnType<typeof useEditor>, videoBlobsRef.current, imageBlobsRef.current));
      }, 250);
    },
    onSelectionUpdate: ({ editor }) => {
      // Don't show the style toolbar for NodeSelection — that's what the
      // drag-handle extension creates when grabbing a block, and it would
      // flash the bar during a drag.
      const selection = editor.state.selection;
      const sel = !selection.empty && !(selection instanceof NodeSelection);
      setHasSelection(sel);
      // Selections inside a code block shouldn't get the prose format bar —
      // bold/italic/link don't apply to raw code.
      setShowToolbar(sel && !editor.isActive("codeBlock"));
      // Show the media toolbar when an image or video is node-selected.
      const isMediaNode = selection instanceof NodeSelection
        && (selection.node.type.name === "image" || selection.node.type.name === "video");
      setShowMediaToolbar(isMediaNode);
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
  editorRef.current = editor;

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
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!editor) return;
      const { $from } = editor.state.selection;
      const depth = $from.depth > 0 ? $from.depth : 1;
      const blockPos = $from.before(depth);
      const domNode = editor.view.nodeDOM(blockPos) as HTMLElement | null;
      if (domNode && domNode.isConnected) {
        hoveredBlockRef.current = domNode;
        computeFromBlockRef.current?.(domNode);
      }
    }));
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

    // After insertion the layout shifts and hoveredBlockRef is null (cleared
    // by resetHandles when the plus menu closed). Find the block via cursor.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!editor) return;
      const { $from } = editor.state.selection;
      const depth = $from.depth > 0 ? $from.depth : 1;
      const blockPos = $from.before(depth);
      const domNode = editor.view.nodeDOM(blockPos) as HTMLElement | null;
      if (domNode && domNode.isConnected) {
        hoveredBlockRef.current = domNode;
        computeFromBlockRef.current?.(domNode);
      }
    }));
  }

  // useLayoutEffect (not useEffect) so the selection collapse runs BEFORE
  // the browser paints the editor's first frame on open. Without this, the
  // editor briefly paints the header image with .ProseMirror-selectednode
  // (selection ring) before the effect removes it — visible in Electron
  // (1ms flash) where the paint timing is slightly tighter than Chrome.
  useLayoutEffect(() => {
    if (editor) {
      editor.setEditable(editable);
      if (editable) {
        const firstType = editor.getJSON().content?.[0]?.type;
        const hasHeaderImage = firstType === "image" || firstType === "video";
        if (hasHeaderImage) {
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
    // editor.view is a getter that throws if the view isn't mounted yet —
    // happens in StrictMode dev where the effect re-runs after a cleanup
    // before EditorContent has had a chance to re-attach the view.
    let tiptapDom: HTMLElement;
    try { tiptapDom = editor.view.dom as HTMLElement; } catch { return; }
    const overlay = tiptapDom.closest("[data-editor-overlay]");
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

  const {
    popup: linkHoverPopup,
    visible: linkHoverVisible,
    onPopupEnter: onLinkPopupEnter,
    onPopupLeave: onLinkPopupLeave,
    dismiss: dismissLinkPopup,
  } = useLinkHoverPopup(editor);

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
  useEffect(() => {
    if (!showMediaToolbar) setMediaTooltips(true);
  }, [showMediaToolbar]);

  // ── Block handle (drag grip + slash menu position tracking) ──
  const {
    handlePos, handleBlockPos,
    editorWrapRef, hoveredBlockRef, computeFromBlockRef,
  } = useBlockHandle({ editor, editable, showPlusMenu, showBlockMenu, hasSelection, plusMenuRef });

  // Mirror handleBlockPos into a ref so the drag-handle click listener (which
  // lives in a useEffect closure) always reads the latest value.
  handleBlockPosRef.current = handleBlockPos;

  // Header videos are overlaid by PersistentVideoPlayer (PVP), which captures
  // clicks for play/pause — so VideoBlockView's mousedown never fires. PVP
  // dispatches a "pvp-select" window event with the video's blockId; find the
  // matching node in this editor's doc and create a NodeSelection so the media
  // toolbar shows.
  useEffect(() => {
    if (!editor || !editable) return;
    const onPvpSelect = (e: Event) => {
      const { blockId } = (e as CustomEvent).detail as { blockId: string };
      if (!blockId) return;
      let targetPos = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "video" && node.attrs.blockId === blockId) {
          targetPos = pos;
          return false;
        }
      });
      if (targetPos < 0) return;
      const cur = editor.state.selection;
      if (cur instanceof NodeSelection && cur.from === targetPos) return;
      editor.chain().setNodeSelection(targetPos).run();
    };
    window.addEventListener("pvp-select", onPvpSelect);
    return () => window.removeEventListener("pvp-select", onPvpSelect);
  }, [editor, editable]);

  // Freeze position + flip direction once when menu opens.
  useLayoutEffect(() => {
    if (!showPlusMenu) { menuPosFrozen.current = false; setFrozenMenuPos(null); return; }
    if (!handlePos || menuPosFrozen.current) return;
    const el = plusMenuRef.current;
    if (!el) return;
    let overlay: HTMLElement | null = null;
    try { overlay = (editor?.view.dom as HTMLElement | undefined)?.closest("[data-editor-overlay]") as HTMLElement | null ?? null; } catch { /* view not mounted */ }
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
      const isActive = i === plusIdxRef.current;
      (el as HTMLElement).classList.toggle("active", isActive);
      if (isActive) (el as HTMLElement).scrollIntoView({ block: "nearest" });
    });
  }, []);

  // ── Block menu (drag-handle click) ──

  // Attach click listener to the extension's drag handle element once it mounts.
  useEffect(() => {
    if (!editor || !editable) return;
    let cancelled = false;
    let removeListener: (() => void) | null = null;
    const attach = () => {
      if (cancelled) return;
      // editor.view throws if the view isn't mounted yet; retry next frame.
      let parent: HTMLElement | null;
      try { parent = (editor.view.dom as HTMLElement).parentElement; }
      catch { requestAnimationFrame(attach); return; }
      const dragEl = parent?.querySelector(".drag-handle[data-drag-handle]") as HTMLElement | null;
      if (!dragEl) { requestAnimationFrame(attach); return; }
      const onClick = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const rect = dragEl.getBoundingClientRect();
        // handleBlockPos snaps to the nearest text position (via
        // TextSelection.near) — for leaf blocks (<hr>, <img>, video) it
        // lands in the adjacent paragraph, not the actual block. Resolve
        // the hovered element's PM position directly via posAtCoords, which
        // returns the exact position without snapping to text.
        let pos: number | null = handleBlockPosRef.current;
        const hovered = hoveredBlockRef.current;
        if (hovered) {
          const hRect = hovered.getBoundingClientRect();
          const result = editor.view.posAtCoords({
            left: hRect.left + hRect.width / 2,
            top: hRect.top + hRect.height / 2,
          });
          if (result) pos = result.pos;
        }
        blockMenuBlockPosRef.current = pos;
        setBlockMenuPos({ x: rect.right + 4, y: rect.top });
        setShowBlockMenu(true);
      };
      dragEl.addEventListener("click", onClick);
      removeListener = () => dragEl.removeEventListener("click", onClick);
    };
    attach();
    return () => { cancelled = true; removeListener?.(); };
  }, [editor, editable]);

  const handleTurnInto = useCallback((def: BlockDef) => {
    if (!editor || blockMenuBlockPosRef.current === null) return;
    editor.chain().focus().setTextSelection(blockMenuBlockPosRef.current).run();
    def.apply?.(editor);
  }, [editor]);

  const handleResetFormatting = useCallback(() => {
    if (!editor || blockMenuBlockPosRef.current === null) return;
    const { state } = editor;
    const $pos = state.doc.resolve(blockMenuBlockPosRef.current);
    const from = $pos.start($pos.depth);
    const to = $pos.end($pos.depth);
    editor.chain().focus().setTextSelection({ from, to }).setParagraph().unsetAllMarks().setTextSelection(to).run();
  }, [editor]);

  // Resolve the top-level block node at blockMenuBlockPosRef. Handles the
  // depth === 0 case (position sits at a leaf like <hr>) via nodeAfter.
  const getTargetBlock = useCallback(() => {
    if (!editor || blockMenuBlockPosRef.current === null) return null;
    const { state } = editor;
    const $pos = state.doc.resolve(blockMenuBlockPosRef.current);
    if ($pos.depth === 0) {
      const node = $pos.nodeAfter;
      if (!node) return null;
      return { from: $pos.pos, to: $pos.pos + node.nodeSize, node };
    }
    const from = $pos.before(1);
    const node = state.doc.nodeAt(from);
    if (!node) return null;
    return { from, to: from + node.nodeSize, node };
  }, [editor]);

  const handleBlockDuplicate = useCallback(() => {
    if (!editor) return;
    const target = getTargetBlock();
    if (!target) return;
    editor.chain().focus().insertContentAt(target.to, target.node.toJSON()).run();
  }, [editor, getTargetBlock]);

  const handleBlockCopy = useCallback(() => {
    if (!editor) return;
    const target = getTargetBlock();
    if (!target) return;
    const { node } = target;
    // For image/video, also stash a NoteBlock in the in-memory media clipboard
    // so Cmd+V on the canvas can create a new card with this media as header.
    if (node.type.name === "image") {
      const src = node.attrs.src as string | null;
      if (src && src.startsWith("data:")) {
        setMediaClipboard({
          id: uuidv4(),
          type: "image",
          content: "",
          imageDataUrl: src,
          imageAspect: (node.attrs.aspect as number | null) ?? 1,
        });
      }
    } else if (node.type.name === "video") {
      const blockId = node.attrs.blockId as string | null;
      const blob = blockId ? videoBlobsRef.current.get(blockId) : null;
      if (blob) {
        setMediaClipboard({
          id: uuidv4(),
          type: "video",
          content: "",
          videoBlob: blob,
          videoPosterDataUrl: (node.attrs.poster as string | undefined) ?? "",
          videoAspect: (node.attrs.aspect as number | null) ?? 1,
          videoMimeType: (node.attrs.mimeType as string | undefined) ?? "video/mp4",
        });
      }
    } else {
      clearMediaClipboard();
    }
    const dom = DOMSerializer.fromSchema(editor.schema).serializeNode(node) as HTMLElement;
    const html = dom.outerHTML;
    const text = node.textContent;
    if (typeof ClipboardItem !== "undefined") {
      const item = new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      });
      navigator.clipboard.write([item]).catch(() => {
        navigator.clipboard.writeText(text).catch(() => {});
      });
    } else {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  }, [editor, getTargetBlock]);

  const handleBlockDelete = useCallback(() => {
    if (!editor) return;
    const sel = editor.state.selection;
    // When a NodeSelection is active on the target (e.g. from the media
    // toolbar), use deleteSelection so the transaction is a simple node-delete
    // that undo can cleanly reverse. deleteRange works too but leaves a
    // transient state where the next block briefly takes the first-child slot,
    // which can desync the header-detection logic during undo.
    if (sel instanceof NodeSelection && sel.from === blockMenuBlockPosRef.current) {
      editor.chain().focus().deleteSelection().run();
      return;
    }
    const target = getTargetBlock();
    if (!target) return;
    editor.chain().focus().deleteRange({ from: target.from, to: target.to }).run();
  }, [editor, getTargetBlock]);

  const handleBlockDownload = useCallback(() => {
    if (!editor) return;
    const target = getTargetBlock();
    if (!target) return;
    const { node } = target;
    const MIME_EXT: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/gif": "gif",
      "image/webp": "webp",
      "image/svg+xml": "svg",
      "image/heic": "heic",
      "video/mp4": "mp4",
      "video/quicktime": "mov",
      "video/webm": "webm",
      "video/ogg": "ogv",
      "video/x-msvideo": "avi",
    };
    const extFrom = (mime: string | null | undefined, fallback: string) =>
      (mime && MIME_EXT[mime.toLowerCase()]) ?? fallback;

    let href: string | null = null;
    let filename = "download";
    if (node.type.name === "image") {
      const blockId = node.attrs.blockId as string | null;
      const meta = blockId ? imageBlobsRef.current.get(blockId) : undefined;
      // Prefer the HD original blob for URL-screenshot cards; otherwise
      // download the display copy. Fall back to the legacy data: URL
      // for old blocks that haven't migrated to Blob storage.
      const downloadBlob = meta?.original ?? meta?.display;
      if (downloadBlob) {
        href = URL.createObjectURL(downloadBlob);
        const mime = meta?.mimeTypeOriginal ?? meta?.mimeType ?? downloadBlob.type;
        filename = `image-${Date.now()}.${extFrom(mime, "png")}`;
      } else {
        const src = node.attrs.src as string | null;
        if (!src) return;
        href = src;
        const mime = /^data:(image\/[a-z0-9+.-]+)/i.exec(src)?.[1];
        filename = `image-${Date.now()}.${extFrom(mime, "png")}`;
      }
    } else if (node.type.name === "video") {
      const src = node.attrs.src as string | null;
      if (!src) return;
      href = src;
      const mime = node.attrs.mimeType as string | null;
      filename = `video-${Date.now()}.${extFrom(mime, "mp4")}`;
    }
    if (!href) return;
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    if (href.startsWith("blob:")) {
      // Cleanup the temporary download URL after a tick so the click
      // has had a chance to fire.
      setTimeout(() => { if (href) URL.revokeObjectURL(href); }, 1000);
    }
  }, [editor, getTargetBlock]);

  // Run a handleBlock* action on the currently NodeSelected node by routing
  // through blockMenuBlockPosRef (which getTargetBlock reads).
  const runOnSelectedNode = useCallback((fn: () => void) => {
    if (!editor) return;
    const sel = editor.state.selection;
    if (!(sel instanceof NodeSelection)) return;
    blockMenuBlockPosRef.current = sel.from;
    fn();
  }, [editor]);

  // Close plus menu on click outside or Escape
  useEffect(() => {
    if (!showPlusMenu) return;
    const onClick = (e: MouseEvent) => {
      if (plusMenuRef.current?.contains(e.target as Node)) return;
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
      {linkHoverPopup && createPortal(
        <div
          data-link-hover-popup
          className={`link-hover-popup${linkHoverVisible ? " visible" : ""}`}
          style={{ left: linkHoverPopup.left, top: linkHoverPopup.top }}
          onMouseEnter={onLinkPopupEnter}
          onMouseLeave={onLinkPopupLeave}
        >
          <button
            type="button"
            onClick={() => {
              window.open(linkHoverPopup.href, "_blank", "noopener,noreferrer");
              dismissLinkPopup();
            }}
          >
            Open <span aria-hidden>↗</span>
          </button>
        </div>,
        document.body,
      )}
      {editable && createPortal(
        <MediaToolbar
          visible={showMediaToolbar}
          tooltipsEnabled={mediaTooltips}
          onSetTooltipsEnabled={setMediaTooltips}
          onDownload={() => runOnSelectedNode(handleBlockDownload)}
          onDuplicate={() => runOnSelectedNode(handleBlockDuplicate)}
          onCopy={() => runOnSelectedNode(handleBlockCopy)}
          onDelete={() => runOnSelectedNode(handleBlockDelete)}
        />,
        document.body,
      )}

      {/* Slash menu — portaled into the editor scroll container so it uses
          position:absolute in document-space. The browser then handles scroll
          tracking natively with zero JS lag. */}
      {editable && showPlusMenu && handlePos && (() => {
        let overlay: HTMLElement | null = null;
        try { overlay = (editor?.view.dom as HTMLElement | undefined)?.closest("[data-editor-overlay]") as HTMLElement | null ?? null; } catch { /* view not mounted */ }
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

      {editable && showBlockMenu && (
        <BlockMenu
          x={blockMenuPos.x}
          y={blockMenuPos.y}
          editor={editor}
          blockPos={blockMenuBlockPosRef.current}
          onTurnInto={handleTurnInto}
          onResetFormatting={handleResetFormatting}
          onDuplicate={handleBlockDuplicate}
          onCopy={handleBlockCopy}
          onDelete={handleBlockDelete}
          onDownload={handleBlockDownload}
          onClose={() => setShowBlockMenu(false)}
        />
      )}
    </div>
  );
}
