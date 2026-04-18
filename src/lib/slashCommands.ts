import type { BlockType } from "../store/db";
import type { Editor } from "@tiptap/react";

export const SLASH_COMMANDS: { label: string; type: BlockType }[] = [
  { label: "Text", type: "text" },
  { label: "Heading 1", type: "heading1" },
  { label: "Heading 2", type: "heading2" },
  { label: "Heading 3", type: "heading3" },
  { label: "Bullet List", type: "bulletList" },
  { label: "Ordered List", type: "orderedList" },
  { label: "To-Do", type: "todo" },
  { label: "Quote", type: "quote" },
  { label: "Code Block", type: "codeBlock" },
  { label: "Divider", type: "hr" },
  { label: "Image", type: "image" },
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
    case "orderedList":
      editor.chain().focus().toggleOrderedList().run();
      break;
    case "todo":
      editor.chain().focus().toggleTaskList().run();
      break;
    case "quote":
      editor.chain().focus().toggleBlockquote().run();
      break;
    case "codeBlock":
      editor.chain().focus().setCodeBlock().run();
      break;
    case "hr":
      editor.chain().focus().setHorizontalRule().run();
      break;
    default:
      editor.chain().focus().setParagraph().run();
  }
}
