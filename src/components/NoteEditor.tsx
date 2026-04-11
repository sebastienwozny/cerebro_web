import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Image from "@tiptap/extension-image";
import { useEffect, useRef } from "react";
import type { NoteBlock, BlockType } from "../store/db";

// ── Convert between our NoteBlock model and TipTap JSON ──

function blocksToHtml(blocks: NoteBlock[]): string {
  return blocks
    .map((b) => {
      const c = escapeHtml(b.content);
      switch (b.type) {
        case "heading1":
          return `<h1>${c}</h1>`;
        case "heading2":
          return `<h2>${c}</h2>`;
        case "heading3":
          return `<h3>${c}</h3>`;
        case "bulletList":
          return `<ul><li><p>${c}</p></li></ul>`;
        case "todo":
          return `<ul data-type="taskList"><li data-type="taskItem" data-checked="${b.isChecked}">${c}</li></ul>`;
        case "quote":
          return `<blockquote><p>${c}</p></blockquote>`;
        default:
          return `<p>${c || ""}</p>`;
      }
    })
    .join("");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function htmlToBlocks(editor: ReturnType<typeof useEditor>): NoteBlock[] {
  if (!editor) return [];
  const json = editor.getJSON();
  const blocks: NoteBlock[] = [];
  const content = json.content ?? [];

  for (const node of content) {
    if (node.type === "heading") {
      const level = (node.attrs?.level ?? 1) as 1 | 2 | 3;
      const typeMap: Record<number, BlockType> = { 1: "heading1", 2: "heading2", 3: "heading3" };
      blocks.push({
        id: crypto.randomUUID(),
        type: typeMap[level] ?? "heading1",
        content: textContent(node),
        isChecked: false,
      });
    } else if (node.type === "bulletList") {
      for (const li of node.content ?? []) {
        blocks.push({
          id: crypto.randomUUID(),
          type: "bulletList",
          content: textContent(li),
          isChecked: false,
        });
      }
    } else if (node.type === "taskList") {
      for (const li of node.content ?? []) {
        blocks.push({
          id: crypto.randomUUID(),
          type: "todo",
          content: textContent(li),
          isChecked: (li as Record<string, unknown>).attrs
            ? ((li as Record<string, unknown>).attrs as Record<string, unknown>)?.checked === true
            : false,
        });
      }
    } else if (node.type === "blockquote") {
      for (const p of node.content ?? []) {
        blocks.push({
          id: crypto.randomUUID(),
          type: "quote",
          content: textContent(p),
          isChecked: false,
        });
      }
    } else {
      blocks.push({
        id: crypto.randomUUID(),
        type: "text",
        content: textContent(node),
        isChecked: false,
      });
    }
  }
  return blocks;
}

function textContent(node: Record<string, unknown>): string {
  if (typeof node.text === "string") return node.text;
  const children = node.content as Record<string, unknown>[] | undefined;
  if (!children) return "";
  return children.map(textContent).join("");
}

// ── Slash command handling ──

const SLASH_COMMANDS: { label: string; type: BlockType; shortcut: string }[] = [
  { label: "Text", type: "text", shortcut: "/" },
  { label: "Heading 1", type: "heading1", shortcut: "/h1" },
  { label: "Heading 2", type: "heading2", shortcut: "/h2" },
  { label: "Heading 3", type: "heading3", shortcut: "/h3" },
  { label: "Bullet List", type: "bulletList", shortcut: "/ul" },
  { label: "To-Do", type: "todo", shortcut: "/todo" },
  { label: "Quote", type: "quote", shortcut: "/quote" },
];

// ── Component ──

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
            executeSlashCommand(SLASH_COMMANDS[slashIdxRef.current]);
            return true;
          }
        }
        return false;
      },
    },
  });

  useEffect(() => {
    if (editor) editor.setEditable(editable);
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

  function executeSlashCommand(cmd: (typeof SLASH_COMMANDS)[number]) {
    if (!editor) return;
    // Delete the "/" character
    const { from } = editor.state.selection;
    editor.chain().focus().deleteRange({ from: from - 1, to: from }).run();

    switch (cmd.type) {
      case "heading1":
        editor.chain().focus().toggleHeading({ level: 1 }).run();
        break;
      case "heading2":
        editor.chain().focus().toggleHeading({ level: 2 }).run();
        break;
      case "heading3":
        editor.chain().focus().toggleHeading({ level: 3 }).run();
        break;
      case "bulletList":
        editor.chain().focus().toggleBulletList().run();
        break;
      case "todo":
        editor.chain().focus().toggleTaskList().run();
        break;
      case "quote":
        editor.chain().focus().toggleBlockquote().run();
        break;
      default:
        editor.chain().focus().setParagraph().run();
    }
    hideSlashMenu();
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
              executeSlashCommand(cmd);
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
