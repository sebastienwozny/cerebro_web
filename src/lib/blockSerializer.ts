import { useEditor } from "@tiptap/react";
import type { NoteBlock, BlockType } from "../store/db";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function blocksToHtml(blocks: NoteBlock[]): string {
  const parts: string[] = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    const c = escapeHtml(b.content);
    if (b.type === "bulletList") {
      let items = `<li><p>${c}</p></li>`;
      while (++i < blocks.length && blocks[i].type === "bulletList") {
        items += `<li><p>${escapeHtml(blocks[i].content)}</p></li>`;
      }
      parts.push(`<ul>${items}</ul>`);
    } else if (b.type === "todo") {
      let items = `<li data-type="taskItem" data-checked="${b.isChecked}"><p>${c}</p></li>`;
      while (++i < blocks.length && blocks[i].type === "todo") {
        items += `<li data-type="taskItem" data-checked="${blocks[i].isChecked}"><p>${escapeHtml(blocks[i].content)}</p></li>`;
      }
      parts.push(`<ul data-type="taskList">${items}</ul>`);
    } else {
      switch (b.type) {
        case "heading1": parts.push(`<h1>${c}</h1>`); break;
        case "heading2": parts.push(`<h2>${c}</h2>`); break;
        case "heading3": parts.push(`<h3>${c}</h3>`); break;
        case "quote": parts.push(`<blockquote><p>${c}</p></blockquote>`); break;
        default: parts.push(`<p>${c || ""}</p>`);
      }
      i++;
    }
  }
  return parts.join("");
}

/** Like blocksToHtml but renders checkboxes for static preview (no TipTap) */
export function blocksToPreviewHtml(blocks: NoteBlock[]): string {
  const parts: string[] = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    const c = escapeHtml(b.content);
    if (b.type === "bulletList") {
      let items = `<li><p>${c}</p></li>`;
      while (++i < blocks.length && blocks[i].type === "bulletList") {
        items += `<li><p>${escapeHtml(blocks[i].content)}</p></li>`;
      }
      parts.push(`<ul>${items}</ul>`);
    } else if (b.type === "todo") {
      const renderTodo = (block: NoteBlock) => {
        const checked = block.isChecked ? "checked" : "";
        const content = escapeHtml(block.content);
        return `<li data-type="taskItem" data-checked="${block.isChecked ?? false}"><label><input type="checkbox" ${checked}></label><div><p>${content}</p></div></li>`;
      };
      let items = renderTodo(b);
      while (++i < blocks.length && blocks[i].type === "todo") {
        items += renderTodo(blocks[i]);
      }
      parts.push(`<ul data-type="taskList">${items}</ul>`);
    } else {
      switch (b.type) {
        case "heading1": parts.push(`<h1>${c}</h1>`); break;
        case "heading2": parts.push(`<h2>${c}</h2>`); break;
        case "heading3": parts.push(`<h3>${c}</h3>`); break;
        case "quote": parts.push(`<blockquote><p>${c}</p></blockquote>`); break;
        default: parts.push(`<p>${c || ""}</p>`);
      }
      i++;
    }
  }
  return parts.join("");
}

function textContent(node: Record<string, unknown>): string {
  if (typeof node.text === "string") return node.text;
  const children = node.content as Record<string, unknown>[] | undefined;
  if (!children) return "";
  return children.map(textContent).join("");
}

export function htmlToBlocks(editor: ReturnType<typeof useEditor>): NoteBlock[] {
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
      });
    } else if (node.type === "bulletList") {
      for (const li of node.content ?? []) {
        blocks.push({
          id: crypto.randomUUID(),
          type: "bulletList",
          content: textContent(li),
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
        });
      }
    } else {
      blocks.push({
        id: crypto.randomUUID(),
        type: "text",
        content: textContent(node),
      });
    }
  }
  return blocks;
}
