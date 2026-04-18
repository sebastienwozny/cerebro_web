import { escapeHtml } from "./blockSerializer";

export function markdownToHtml(md: string): string {
  const lines = md.split("\n");
  const htmlParts: string[] = [];
  let inUl = false;
  let inOl = false;
  let inTaskList = false;

  function flushList() {
    if (inUl) { htmlParts.push("</ul>"); inUl = false; }
    if (inOl) { htmlParts.push("</ol>"); inOl = false; }
    if (inTaskList) { htmlParts.push("</ul>"); inTaskList = false; }
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trimEnd();

    // Fenced code block — consume lines until the closing fence.
    const fenceMatch = line.match(/^```(.*)$/);
    if (fenceMatch) {
      flushList();
      const lang = fenceMatch[1].trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      const classAttr = lang ? ` class="language-${escapeHtml(lang)}"` : "";
      htmlParts.push(`<pre><code${classAttr}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      continue;
    }

    // Horizontal rule
    if (/^(\s*[-*_]\s*){3,}$/.test(line) && line.trim().length >= 3) {
      flushList();
      htmlParts.push("<hr>");
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.*)/);
    if (headingMatch) {
      flushList();
      const level = headingMatch[1].length;
      htmlParts.push(`<h${level}>${escapeHtml(headingMatch[2])}</h${level}>`);
      continue;
    }

    const taskMatch = line.match(/^[-*]?\s*\[([xX ])\]\s*(.*)/);
    if (taskMatch) {
      if (inUl) { htmlParts.push("</ul>"); inUl = false; }
      if (inOl) { htmlParts.push("</ol>"); inOl = false; }
      if (!inTaskList) { htmlParts.push('<ul data-type="taskList">'); inTaskList = true; }
      const checked = taskMatch[1].toLowerCase() === "x";
      htmlParts.push(`<li data-type="taskItem" data-checked="${checked}"><p>${escapeHtml(taskMatch[2])}</p></li>`);
      continue;
    }

    const bulletMatch = line.match(/^[-*]\s+(.*)/);
    if (bulletMatch) {
      if (inTaskList) { htmlParts.push("</ul>"); inTaskList = false; }
      if (inOl) { htmlParts.push("</ol>"); inOl = false; }
      if (!inUl) { htmlParts.push("<ul>"); inUl = true; }
      htmlParts.push(`<li><p>${escapeHtml(bulletMatch[1])}</p></li>`);
      continue;
    }

    const orderedMatch = line.match(/^\d+\.\s+(.*)/);
    if (orderedMatch) {
      if (inTaskList) { htmlParts.push("</ul>"); inTaskList = false; }
      if (inUl) { htmlParts.push("</ul>"); inUl = false; }
      if (!inOl) { htmlParts.push("<ol>"); inOl = true; }
      htmlParts.push(`<li><p>${escapeHtml(orderedMatch[1])}</p></li>`);
      continue;
    }

    const quoteMatch = line.match(/^>\s*(.*)/);
    if (quoteMatch) {
      flushList();
      htmlParts.push(`<blockquote><p>${escapeHtml(quoteMatch[1])}</p></blockquote>`);
      continue;
    }

    if (line.trim() === "") {
      flushList();
      continue;
    }

    flushList();
    htmlParts.push(`<p>${escapeHtml(line)}</p>`);
  }

  flushList();
  return htmlParts.join("");
}

export function looksLikeMarkdown(text: string): boolean {
  return /^#{1,3}\s|^[-*]\s|^\d+\.\s|^>\s|^\[[ xX]\]|^```|^(\s*[-*_]\s*){3,}$/m.test(text);
}
