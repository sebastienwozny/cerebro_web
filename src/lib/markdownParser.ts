import { escapeHtml } from "./blockSerializer";

export function markdownToHtml(md: string): string {
  const lines = md.split("\n");
  const htmlParts: string[] = [];
  let inList = false;
  let inTaskList = false;

  function flushList() {
    if (inList) { htmlParts.push("</ul>"); inList = false; }
    if (inTaskList) { htmlParts.push("</ul>"); inTaskList = false; }
  }

  for (const raw of lines) {
    const line = raw.trimEnd();

    const headingMatch = line.match(/^(#{1,3})\s+(.*)/);
    if (headingMatch) {
      flushList();
      const level = headingMatch[1].length;
      htmlParts.push(`<h${level}>${escapeHtml(headingMatch[2])}</h${level}>`);
      continue;
    }

    const taskMatch = line.match(/^[-*]?\s*\[([xX ])\]\s*(.*)/);
    if (taskMatch) {
      if (inList) { htmlParts.push("</ul>"); inList = false; }
      if (!inTaskList) { htmlParts.push('<ul data-type="taskList">'); inTaskList = true; }
      const checked = taskMatch[1].toLowerCase() === "x";
      htmlParts.push(`<li data-type="taskItem" data-checked="${checked}"><p>${escapeHtml(taskMatch[2])}</p></li>`);
      continue;
    }

    const bulletMatch = line.match(/^[-*]\s+(.*)/);
    if (bulletMatch) {
      if (inTaskList) { htmlParts.push("</ul>"); inTaskList = false; }
      if (!inList) { htmlParts.push("<ul>"); inList = true; }
      htmlParts.push(`<li><p>${escapeHtml(bulletMatch[1])}</p></li>`);
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
  return /^#{1,3}\s|^[-*]\s|^>\s|^\[[ xX]\]/m.test(text);
}
