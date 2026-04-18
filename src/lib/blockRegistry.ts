import type { ComponentType } from "react";
import type { Editor } from "@tiptap/react";
import {
  Type,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Code,
  Minus,
  ImageIcon,
} from "lucide-react";
import type { BlockType } from "../store/db";

export interface BlockDef {
  type: BlockType;
  label: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  slashShortcut: string;
  /**
   * Convert the currently-focused empty block into this block type.
   * `image` has no apply (the caller opens a file picker).
   */
  apply: ((editor: Editor) => void) | null;
}

export const BLOCK_DEFS: BlockDef[] = [
  {
    type: "text",
    label: "Text",
    icon: Type,
    slashShortcut: "",
    apply: (e) => { e.chain().focus().setParagraph().run(); },
  },
  {
    type: "heading1",
    label: "Heading 1",
    icon: Heading1,
    slashShortcut: "#",
    apply: (e) => { e.chain().focus().setHeading({ level: 1 }).run(); },
  },
  {
    type: "heading2",
    label: "Heading 2",
    icon: Heading2,
    slashShortcut: "##",
    apply: (e) => { e.chain().focus().setHeading({ level: 2 }).run(); },
  },
  {
    type: "heading3",
    label: "Heading 3",
    icon: Heading3,
    slashShortcut: "###",
    apply: (e) => { e.chain().focus().setHeading({ level: 3 }).run(); },
  },
  {
    type: "bulletList",
    label: "Bullet List",
    icon: List,
    slashShortcut: "-",
    // `toggle*` would convert back to a paragraph if we're already inside the
    // target list (e.g. after splitListItem), so guard with isActive first.
    apply: (e) => { if (!e.isActive("bulletList")) e.chain().focus().toggleBulletList().run(); },
  },
  {
    type: "orderedList",
    label: "Ordered List",
    icon: ListOrdered,
    slashShortcut: "1.",
    apply: (e) => { if (!e.isActive("orderedList")) e.chain().focus().toggleOrderedList().run(); },
  },
  {
    type: "todo",
    label: "To-Do",
    icon: ListChecks,
    slashShortcut: "[]",
    apply: (e) => { if (!e.isActive("taskList")) e.chain().focus().toggleTaskList().run(); },
  },
  {
    type: "quote",
    label: "Quote",
    icon: Quote,
    slashShortcut: ">",
    apply: (e) => { if (!e.isActive("blockquote")) e.chain().focus().toggleBlockquote().run(); },
  },
  {
    type: "codeBlock",
    label: "Code Block",
    icon: Code,
    slashShortcut: "```",
    apply: (e) => { e.chain().focus().setCodeBlock().run(); },
  },
  {
    type: "hr",
    label: "Divider",
    icon: Minus,
    slashShortcut: "---",
    apply: (e) => { e.chain().focus().setHorizontalRule().run(); },
  },
  {
    type: "image",
    label: "Image",
    icon: ImageIcon,
    slashShortcut: "/image",
    apply: null,
  },
];

export const BLOCK_DEF: Record<BlockType, BlockDef> =
  Object.fromEntries(BLOCK_DEFS.map((d) => [d.type, d])) as Record<BlockType, BlockDef>;
