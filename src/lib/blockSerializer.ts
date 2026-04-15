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
    const c = b.content;
    if (b.type === "image") {
      if (b.imageDataUrl) {
        const aspect = b.imageAspect ? ` data-aspect="${b.imageAspect}"` : "";
        parts.push(`<img src="${b.imageDataUrl}"${aspect} />`);
      }
      i++;
    } else if (b.type === "bulletList") {
      let items = `<li><p>${c}</p></li>`;
      while (++i < blocks.length && blocks[i].type === "bulletList") {
        items += `<li><p>${blocks[i].content}</p></li>`;
      }
      parts.push(`<ul>${items}</ul>`);
    } else if (b.type === "todo") {
      let items = `<li data-type="taskItem" data-checked="${b.isChecked}"><p>${c}</p></li>`;
      while (++i < blocks.length && blocks[i].type === "todo") {
        items += `<li data-type="taskItem" data-checked="${blocks[i].isChecked}"><p>${blocks[i].content}</p></li>`;
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
    const c = b.content;
    if (b.type === "image") {
      if (b.imageDataUrl) {
        parts.push(`<img src="${b.imageDataUrl}" alt="" style="width:100%;display:block;border-radius:8px;margin:8px 0" />`);
      }
      i++;
    } else if (b.type === "bulletList") {
      let items = `<li><p>${c}</p></li>`;
      while (++i < blocks.length && blocks[i].type === "bulletList") {
        items += `<li><p>${blocks[i].content}</p></li>`;
      }
      parts.push(`<ul>${items}</ul>`);
    } else if (b.type === "todo") {
      const renderTodo = (block: NoteBlock) => {
        const checked = block.isChecked ? "checked" : "";
        return `<li data-type="taskItem" data-checked="${block.isChecked ?? false}"><label><input type="checkbox" ${checked}></label><div><p>${block.content}</p></div></li>`;
      };
      let items = renderTodo(b);
      while (++i < blocks.length && blocks[i].type === "todo") {
        items += renderTodo(blocks[i]);
      }
      parts.push(`<ul data-type="taskList">${items}</ul>`);
    } else {
      const fill = c || "<br>";
      switch (b.type) {
        case "heading1": parts.push(`<h1>${fill}</h1>`); break;
        case "heading2": parts.push(`<h2>${fill}</h2>`); break;
        case "heading3": parts.push(`<h3>${fill}</h3>`); break;
        case "quote": parts.push(`<blockquote><p>${fill}</p></blockquote>`); break;
        default: parts.push(`<p>${fill}</p>`);
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

/** Serialize inline content (text + marks like bold, italic, links) to HTML */
function inlineHtml(node: Record<string, unknown>): string {
  const children = node.content as Record<string, unknown>[] | undefined;
  if (!children) return "";
  return children.map(child => {
    if (child.type === "text") {
      let html = escapeHtml(child.text as string);
      const marks = child.marks as Array<{ type: string; attrs?: Record<string, unknown> }> | undefined;
      if (marks) {
        for (const mark of marks) {
          switch (mark.type) {
            case "bold": html = `<strong>${html}</strong>`; break;
            case "italic": html = `<em>${html}</em>`; break;
            case "underline": html = `<u>${html}</u>`; break;
            case "strike": html = `<s>${html}</s>`; break;
            case "link": {
              const href = escapeHtml((mark.attrs?.href as string) || "");
              const target = mark.attrs?.target ? ` target="${escapeHtml(mark.attrs.target as string)}"` : "";
              html = `<a href="${href}"${target}>${html}</a>`;
              break;
            }
          }
        }
      }
      return html;
    }
    return "";
  }).join("");
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
        content: inlineHtml(node),
      });
    } else if (node.type === "bulletList") {
      for (const li of node.content ?? []) {
        const p = (li as Record<string, unknown>).content as Record<string, unknown>[] | undefined;
        blocks.push({
          id: crypto.randomUUID(),
          type: "bulletList",
          content: p ? p.map(n => inlineHtml(n)).join("") : textContent(li),
        });
      }
    } else if (node.type === "taskList") {
      for (const li of node.content ?? []) {
        const p = (li as Record<string, unknown>).content as Record<string, unknown>[] | undefined;
        blocks.push({
          id: crypto.randomUUID(),
          type: "todo",
          content: p ? p.map(n => inlineHtml(n)).join("") : textContent(li),
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
          content: inlineHtml(p),
        });
      }
    } else if (node.type === "image") {
      const attrs = node.attrs as Record<string, unknown> | undefined;
      blocks.push({
        id: crypto.randomUUID(),
        type: "image",
        content: "",
        imageDataUrl: (attrs?.src as string) ?? "",
        imageAspect: attrs?.aspect ? Number(attrs.aspect) : undefined,
      });
    } else {
      blocks.push({
        id: crypto.randomUUID(),
        type: "text",
        content: inlineHtml(node),
      });
    }
  }
  return blocks;
}
