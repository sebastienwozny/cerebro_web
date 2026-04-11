import { useEditor, EditorContent } from "@tiptap/react";
import { DOMParser } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Image from "@tiptap/extension-image";
import { useEffect, useRef } from "react";
import type { NoteBlock } from "../store/db";
import { blocksToHtml, htmlToBlocks } from "../lib/blockSerializer";
import { markdownToHtml, looksLikeMarkdown } from "../lib/markdownParser";
import { SLASH_COMMANDS, executeSlashCommand } from "../lib/slashCommands";

interface Props {
  blocks: NoteBlock[];
  onUpdate: (blocks: NoteBlock[]) => void;
  editable: boolean;
  headerImageUrl?: string;
}

export default function NoteEditor({ blocks, onUpdate, editable, headerImageUrl }: Props) {
  const initialHtml = useRef(blocksToHtml(blocks));
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const slashIdxRef = useRef(0);

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
      Image,
    ],
    content: initialHtml.current,
    editable,
    onUpdate: ({ editor }) => {
      onUpdate(htmlToBlocks(editor as ReturnType<typeof useEditor>));
      hideSlashMenu();
    },
    editorProps: {
      handlePaste: (view, event) => {
        const text = event.clipboardData?.getData("text/plain");
        if (text && looksLikeMarkdown(text)) {
          event.preventDefault();
          const converted = markdownToHtml(text);
          const parser = DOMParser.fromSchema(view.state.schema);
          const tempDiv = document.createElement("div");
          tempDiv.innerHTML = converted;
          const slice = parser.parseSlice(tempDiv);
          const tr = view.state.tr.replaceSelection(slice);
          view.dispatch(tr);
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
            if (editor) {
              executeSlashCommand(editor, SLASH_COMMANDS[slashIdxRef.current]);
              hideSlashMenu();
            }
            return true;
          }
        }
        return false;
      },
    },
  });

  useEffect(() => {
    if (editor) {
      editor.setEditable(editable);
      if (editable) {
        editor.chain().focus("start").run();
      }
    }
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
      {headerImageUrl && (
        <div className="note-editor-header-image">
          <img src={headerImageUrl} alt="" />
        </div>
      )}
      <EditorContent editor={editor} />
      <div ref={slashMenuRef} className="slash-menu" style={{ display: "none" }}>
        {SLASH_COMMANDS.map((cmd, i) => (
          <div
            key={cmd.type}
            data-slash-item
            className={`slash-menu-item ${i === 0 ? "active" : ""}`}
            onMouseDown={(e) => {
              e.preventDefault();
              if (editor) {
                executeSlashCommand(editor, cmd);
                hideSlashMenu();
              }
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
    </div>
  );
}
