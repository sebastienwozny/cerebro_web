import { useEditor, EditorContent } from "@tiptap/react";
import { DOMParser } from "@tiptap/pm/model";
import { createPortal } from "react-dom";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import BaseImage from "@tiptap/extension-image";
import Underline from "@tiptap/extension-underline";
import { useEffect, useRef, useState } from "react";
import { Bold, Italic, Underline as UnderlineIcon, Strikethrough, Eraser } from "lucide-react";
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
  const [hasSelection, setHasSelection] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInsertPosRef = useRef<number | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
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
    ],
    content: initialHtml.current,
    editable,
    onUpdate: ({ editor }) => {
      onUpdate(htmlToBlocks(editor as ReturnType<typeof useEditor>));
      hideSlashMenu();
    },
    onSelectionUpdate: ({ editor }) => {
      setHasSelection(!editor.state.selection.empty);
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

  // Click below content to insert empty lines
  useEffect(() => {
    if (!editor || !editable) return;
    const overlay = editor.view.dom.closest("[data-editor-overlay]");
    if (!overlay) return;
    const handleOverlayClick = (e: Event) => {
      const me = e as MouseEvent;
      const tiptap = editor.view.dom;
      const tiptapRect = tiptap.getBoundingClientRect();

      // Click in left/right margins — clear selection
      if (me.clientX < tiptapRect.left || me.clientX > tiptapRect.right) {
        editor.commands.blur();
        setHasSelection(false);
        return;
      }

      const lastChild = tiptap.lastElementChild as HTMLElement | null;
      const contentBottom = lastChild
        ? lastChild.getBoundingClientRect().bottom
        : tiptapRect.top;
      if (me.clientY <= contentBottom) return;
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

  return (
    <div className="note-editor">
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
      {/* Floating format toolbar — rendered via portal so fixed positioning works */}
      {editable && createPortal(
        <div
          className={`fixed left-1/2 -translate-x-1/2 flex items-center gap-1 p-1.5 backdrop-blur-xl rounded-xl border border-white/8 transition-all duration-300 ${hasSelection ? "ease-[cubic-bezier(0,0,0.35,1)] bottom-10 scale-100" : "ease-[cubic-bezier(0.65,0,1,1)] -bottom-24 scale-80"}`}
          style={{ zIndex: 10002, background: "#1a1c1e", boxShadow: "0 -10px 40px -10px rgba(0,0,0,0.15), 0 20px 25px -5px rgba(0,0,0,0.3), 0 8px 10px -6px rgba(0,0,0,0.3), 0 40px 80px -20px rgba(0,0,0,0.25), 0 70px 140px -30px rgba(0,0,0,0.2), 0 120px 240px -40px rgba(0,0,0,0.15)" }}
        >
          {[
            { icon: Bold, label: "Bold", cmd: () => editor?.chain().focus().toggleBold().run(), active: editor?.isActive("bold"), shortcut: "⌘B" },
            { icon: Italic, label: "Italic", cmd: () => editor?.chain().focus().toggleItalic().run(), active: editor?.isActive("italic"), shortcut: "⌘I" },
            { icon: UnderlineIcon, label: "Underline", cmd: () => editor?.chain().focus().toggleUnderline().run(), active: editor?.isActive("underline"), shortcut: "⌘U" },
            { icon: Strikethrough, label: "Strikethrough", cmd: () => editor?.chain().focus().toggleStrike().run(), active: editor?.isActive("strike"), shortcut: "⌘⇧X" },
          ].map(({ icon: Icon, label, cmd, active, shortcut }, i) => (
            <div key={i} className="relative group flex flex-col items-center transition-transform duration-120 ease-out hover:scale-108">
              <button
                onMouseDown={(e) => { e.preventDefault(); cmd(); }}
                className={`w-10 h-10 rounded-lg flex items-center justify-center border-none cursor-pointer select-none transition-colors duration-150 ${active ? "text-white bg-[#333] dark:bg-neutral-800" : "text-neutral-300 bg-transparent hover:bg-[#333] hover:text-white dark:hover:bg-neutral-800"}`}
              >
                <Icon className="w-4 h-[18px]" strokeWidth={2.5} />
              </button>
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 px-2 py-1 rounded-lg text-[9px] font-semibold uppercase whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 shadow-lg bg-neutral-800 text-white/90 border border-white/8 flex items-center gap-2">
                <span>{label}</span>
                <span className="text-white/60">{shortcut}</span>
              </div>
            </div>
          ))}
          <div className="relative group flex flex-col items-center transition-transform duration-120 ease-out hover:scale-110">
            <button
              onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().unsetAllMarks().run(); }}
              className="w-10 h-10 rounded-lg flex items-center justify-center border-none cursor-pointer select-none text-neutral-300 bg-transparent hover:bg-[#333] hover:text-white dark:hover:bg-neutral-800 transition-colors duration-150"
            >
              <Eraser className="w-4 h-[18px]" strokeWidth={2.5} />
            </button>
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 px-2 py-1 rounded-lg text-[9px] font-semibold uppercase whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 shadow-lg bg-neutral-800 text-white/90 border border-white/8">
              Clear
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
