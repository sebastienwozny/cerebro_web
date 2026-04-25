import { db } from "../store/db";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Image from "@tiptap/extension-image";
import Underline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";
import gsap from "gsap";

/**
 * Pre-warm Dexie (IndexedDB), TipTap (ProseMirror schema compilation),
 * and GSAP so the first interactions feel instant.
 */
export function warmup() {
  // Run after first paint so we don't block initial render.
  // Safari doesn't support requestIdleCallback — setTimeout(0) is equivalent enough here.
  const schedule = typeof requestIdleCallback !== "undefined" ? requestIdleCallback : (cb: () => void) => setTimeout(cb, 0);
  schedule(() => {
    // 1. Eagerly open IndexedDB
    db.open();

    // 2. Create a throwaway TipTap editor to compile the ProseMirror schema & plugins
    const el = document.createElement("div");
    document.body.appendChild(el);
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
      content: "<p>warm</p>",
    });
    // Let the editor fully initialize before destroying
    requestAnimationFrame(() => {
      editor.destroy();
      el.remove();
    });

    // 3. Pre-warm GSAP by running a throwaway tween (gsap is already in the
    // main chunk via Canvas.tsx, so no extra fetch).
    const dummy = { v: 0 };
    gsap.to(dummy, { v: 1, duration: 0.01 });
  });
}
