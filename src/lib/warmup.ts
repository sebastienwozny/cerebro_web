import { db } from "../store/db";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Image from "@tiptap/extension-image";
import Underline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";

/**
 * Pre-warm Dexie (IndexedDB) and TipTap (ProseMirror schema compilation)
 * so the first card creation + editor open feel instant.
 */
export function warmup() {
  // 1. Eagerly open IndexedDB
  db.open();

  // 2. Create a throwaway TipTap editor to compile the ProseMirror schema & plugins
  const el = document.createElement("div");
  const editor = new Editor({
    element: el,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder,
      TaskList,
      TaskItem.configure({ nested: false }),
      Image,
      Underline,
    ],
    content: "",
  });
  // Destroy once schema is compiled — no need to keep it around
  editor.destroy();
}
