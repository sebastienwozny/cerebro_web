import { useEditor } from "@tiptap/react";
import { createLowlight, common } from "lowlight";
import type { NoteBlock, BlockType } from "../store/db";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Shared lowlight instance so the preview renders the same highlighted tokens
// as the editor (which uses CodeBlockLowlight).
const lowlight = createLowlight(common);

type HastNode =
  | { type: "root"; children: HastNode[] }
  | { type: "element"; tagName: string; properties?: { className?: string[] }; children: HastNode[] }
  | { type: "text"; value: string };

function hastToHtml(node: HastNode): string {
  if (node.type === "text") return escapeHtml(node.value);
  if (node.type === "root") return node.children.map(hastToHtml).join("");
  const cls = node.properties?.className?.join(" ") ?? "";
  const attrs = cls ? ` class="${escapeHtml(cls)}"` : "";
  return `<${node.tagName}${attrs}>${node.children.map(hastToHtml).join("")}</${node.tagName}>`;
}

function hastTextContent(node: HastNode): string {
  if (node.type === "text") return node.value;
  if (node.type === "root") return node.children.map(hastTextContent).join("");
  return node.children.map(hastTextContent).join("");
}

function highlightCode(code: string, language: string | undefined): string {
  if (!language || language === "plaintext") return escapeHtml(code);
  if (!lowlight.listLanguages().includes(language)) return escapeHtml(code);
  const tree = lowlight.highlight(language, code) as HastNode;
  // highlight.js XML grammar (and a few others) occasionally drops the
  // whitespace between adjacent tags — the text node simply isn't emitted
  // in the hast tree. If the tokenizer's textContent doesn't match the raw
  // code, fall back to an un-highlighted but correctly-whitespaced escape
  // rather than render visually broken output.
  if (hastTextContent(tree) !== code) return escapeHtml(code);
  return hastToHtml(tree);
}

/** Collect consecutive blocks starting at `start` that share `type`. */
function takeRun(blocks: NoteBlock[], start: number, type: BlockType): { items: NoteBlock[]; next: number } {
  const items: NoteBlock[] = [blocks[start]];
  let j = start + 1;
  while (j < blocks.length && blocks[j].type === type) {
    items.push(blocks[j]);
    j++;
  }
  return { items, next: j };
}

function codeBlockAttrs(b: NoteBlock): { cls: string; wrap: string } {
  return {
    cls: b.codeLanguage ? ` class="language-${escapeHtml(b.codeLanguage)}"` : "",
    wrap: b.codeWrap ? ` data-wrap="true"` : "",
  };
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
    } else if (b.type === "bulletList" || b.type === "orderedList") {
      const run = takeRun(blocks, i, b.type);
      const tag = b.type === "bulletList" ? "ul" : "ol";
      const items = run.items.map((x) => `<li><p>${x.content}</p></li>`).join("");
      parts.push(`<${tag}>${items}</${tag}>`);
      i = run.next;
    } else if (b.type === "todo") {
      const run = takeRun(blocks, i, "todo");
      const items = run.items
        .map((x) => `<li data-type="taskItem" data-checked="${x.isChecked}"><p>${x.content}</p></li>`)
        .join("");
      parts.push(`<ul data-type="taskList">${items}</ul>`);
      i = run.next;
    } else {
      switch (b.type) {
        case "heading1": parts.push(`<h1>${c}</h1>`); break;
        case "heading2": parts.push(`<h2>${c}</h2>`); break;
        case "heading3": parts.push(`<h3>${c}</h3>`); break;
        case "quote": parts.push(`<blockquote><p>${c}</p></blockquote>`); break;
        case "codeBlock": {
          const { cls, wrap } = codeBlockAttrs(b);
          // Don't pre-highlight — TipTap's CodeBlockLowlight plugin applies
          // syntax highlighting as ProseMirror decorations at render time.
          // Embedding pre-highlighted spans here risks whitespace corruption
          // when the highlighter's hast tree drops text nodes between tokens
          // (hljs XML grammar, etc.), and those spans would be discarded on
          // parse anyway since the codeBlock schema only stores plain text.
          parts.push(`<pre${wrap}><code${cls}>${escapeHtml(c)}</code></pre>`);
          break;
        }
        case "hr": parts.push(`<hr>`); break;
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
    } else if (b.type === "bulletList" || b.type === "orderedList") {
      const run = takeRun(blocks, i, b.type);
      const tag = b.type === "bulletList" ? "ul" : "ol";
      const items = run.items.map((x) => `<li><p>${x.content}</p></li>`).join("");
      parts.push(`<${tag}>${items}</${tag}>`);
      i = run.next;
    } else if (b.type === "todo") {
      const run = takeRun(blocks, i, "todo");
      const items = run.items
        .map((x) => {
          const checked = x.isChecked ? "checked" : "";
          return `<li data-type="taskItem" data-checked="${x.isChecked ?? false}"><label><input type="checkbox" ${checked}></label><div><p>${x.content}</p></div></li>`;
        })
        .join("");
      parts.push(`<ul data-type="taskList">${items}</ul>`);
      i = run.next;
    } else {
      const fill = c || "<br>";
      switch (b.type) {
        case "heading1": parts.push(`<h1>${fill}</h1>`); break;
        case "heading2": parts.push(`<h2>${fill}</h2>`); break;
        case "heading3": parts.push(`<h3>${fill}</h3>`); break;
        case "quote": parts.push(`<blockquote><p>${fill}</p></blockquote>`); break;
        case "codeBlock": {
          const { cls, wrap } = codeBlockAttrs(b);
          const highlighted = highlightCode(c, b.codeLanguage);
          parts.push(`<pre${wrap}><div class="code-block-scroll">`
            + `<code${cls}>${highlighted}</code></div></pre>`);
          break;
        }
        case "hr": parts.push(`<hr>`); break;
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
            case "code": html = `<code>${html}</code>`; break;
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
    } else if (node.type === "orderedList") {
      for (const li of node.content ?? []) {
        const p = (li as Record<string, unknown>).content as Record<string, unknown>[] | undefined;
        blocks.push({
          id: crypto.randomUUID(),
          type: "orderedList",
          content: p ? p.map(n => inlineHtml(n)).join("") : textContent(li),
        });
      }
    } else if (node.type === "codeBlock") {
      const attrs = node.attrs as Record<string, unknown> | undefined;
      const lang = attrs?.language as string | undefined;
      const wrap = attrs?.wrap === true;
      blocks.push({
        id: crypto.randomUUID(),
        type: "codeBlock",
        content: textContent(node),
        ...(lang ? { codeLanguage: lang } : {}),
        ...(wrap ? { codeWrap: true } : {}),
      });
    } else if (node.type === "horizontalRule") {
      blocks.push({
        id: crypto.randomUUID(),
        type: "hr",
        content: "",
      });
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
