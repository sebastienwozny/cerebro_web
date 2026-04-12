import React, { useMemo } from "react";
import type { NoteBlock } from "../store/db";
import { escapeHtml } from "../lib/blockSerializer";

function blocksToPreviewHtml(blocks: NoteBlock[]): string {
  const parts: string[] = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    const c = escapeHtml(b.content);
    const isEmpty = !b.content;
    if (b.type === "bulletList") {
      let items = `<li><p>${c}</p></li>`;
      while (++i < blocks.length && blocks[i].type === "bulletList") {
        items += `<li><p>${escapeHtml(blocks[i].content)}</p></li>`;
      }
      parts.push(`<ul>${items}</ul>`);
    } else if (b.type === "todo") {
      let items = "";
      const renderTodo = (block: NoteBlock) => {
        const checked = block.isChecked ? "checked" : "";
        const content = escapeHtml(block.content);
        return `<li data-type="taskItem" data-checked="${block.isChecked ?? false}"><label><input type="checkbox" ${checked}></label><div><p>${content}</p></div></li>`;
      };
      items += renderTodo(b);
      while (++i < blocks.length && blocks[i].type === "todo") {
        items += renderTodo(blocks[i]);
      }
      parts.push(`<ul data-type="taskList">${items}</ul>`);
    } else {
      switch (b.type) {
        case "heading1":
          parts.push(isEmpty
            ? `<h1 class="is-empty" data-placeholder="Untitled"></h1>`
            : `<h1>${c}</h1>`);
          break;
        case "heading2": parts.push(`<h2>${c}</h2>`); break;
        case "heading3": parts.push(`<h3>${c}</h3>`); break;
        case "quote": parts.push(`<blockquote><p>${c}</p></blockquote>`); break;
        default:
          parts.push(isEmpty
            ? `<p class="is-empty" data-placeholder="Press '/' for commands"></p>`
            : `<p>${c}</p>`);
      }
      i++;
    }
  }
  return parts.join("");
}

interface Props {
  blocks: NoteBlock[];
  headerImageUrl?: string;
}

function NotePreview({ blocks, headerImageUrl }: Props) {
  const html = useMemo(() => blocksToPreviewHtml(blocks), [blocks]);

  return (
    <div className="note-editor">
      {headerImageUrl && (
        <div className="note-editor-header-image">
          <img src={headerImageUrl} alt="" />
        </div>
      )}
      <div className="tiptap" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

export default React.memo(NotePreview);
