import type { BlockType } from "../store/db";
import type { Editor } from "@tiptap/react";

export const SLASH_COMMANDS: { label: string; type: BlockType; shortcut: string }[] = [
  { label: "Text", type: "text", shortcut: "/" },
  { label: "Heading 1", type: "heading1", shortcut: "/h1" },
  { label: "Heading 2", type: "heading2", shortcut: "/h2" },
  { label: "Heading 3", type: "heading3", shortcut: "/h3" },
  { label: "Bullet List", type: "bulletList", shortcut: "/ul" },
  { label: "To-Do", type: "todo", shortcut: "/todo" },
  { label: "Quote", type: "quote", shortcut: "/quote" },
];

export function executeSlashCommand(editor: Editor, cmd: (typeof SLASH_COMMANDS)[number]) {
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
}
