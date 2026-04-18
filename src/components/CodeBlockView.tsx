import { useEffect, useState } from "react";
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { Copy, Check, WrapText } from "lucide-react";

// Shown in the picker. Order matters — popular first.
const LANGUAGES: Array<{ value: string; label: string }> = [
  { value: "plaintext", label: "Plain text" },
  { value: "typescript", label: "TypeScript" },
  { value: "javascript", label: "JavaScript" },
  { value: "python", label: "Python" },
  { value: "bash", label: "Shell" },
  { value: "json", label: "JSON" },
  { value: "yaml", label: "YAML" },
  { value: "xml", label: "HTML/XML" },
  { value: "css", label: "CSS" },
  { value: "scss", label: "SCSS" },
  { value: "markdown", label: "Markdown" },
  { value: "go", label: "Go" },
  { value: "rust", label: "Rust" },
  { value: "java", label: "Java" },
  { value: "kotlin", label: "Kotlin" },
  { value: "swift", label: "Swift" },
  { value: "c", label: "C" },
  { value: "cpp", label: "C++" },
  { value: "csharp", label: "C#" },
  { value: "ruby", label: "Ruby" },
  { value: "php", label: "PHP" },
  { value: "sql", label: "SQL" },
  { value: "diff", label: "Diff" },
];

export default function CodeBlockView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  const [copied, setCopied] = useState(false);
  const language = (node.attrs.language as string | null) ?? "plaintext";
  const wrap = (node.attrs.wrap as boolean) ?? false;
  const label = LANGUAGES.find((l) => l.value === language)?.label ?? language;

  // Clicks on the pre's padding (not on the <code> text or the header) select
  // the whole block so the user can delete it. Must use a native capture-phase
  // listener — React synthetic events can't stop ProseMirror's native mousedown
  // handler from placing a text cursor and overriding the NodeSelection.
  useEffect(() => {
    const pos = getPos();
    if (pos === undefined) return;
    const el = editor.view.nodeDOM(pos) as HTMLElement | null;
    if (!el) return;
    const onDown = (e: MouseEvent) => {
      if (e.target !== el) return;
      const currentPos = getPos();
      if (currentPos === undefined) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const tr = editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, currentPos));
      editor.view.dispatch(tr);
      editor.view.focus();
    };
    el.addEventListener("mousedown", onDown, true);
    return () => el.removeEventListener("mousedown", onDown, true);
  }, [editor, getPos, node]);

  // Mirror the node's `wrap` attribute onto the outer <pre> as `data-wrap`
  // so the CSS selector `.tiptap pre[data-wrap="true"]` can match. We do
  // this imperatively rather than via ReactNodeViewRenderer's `attrs`
  // option because the wrapper React element NodeViewWrapper renders sits
  // *inside* the outer <pre>, not on it.
  useEffect(() => {
    const pos = getPos();
    if (pos === undefined) return;
    const el = editor.view.nodeDOM(pos) as HTMLElement | null;
    if (!el) return;
    if (wrap) el.setAttribute("data-wrap", "true");
    else el.removeAttribute("data-wrap");
  }, [editor, getPos, wrap]);

  async function onCopy() {
    const text = node.textContent;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard denied — no-op
    }
  }

  return (
    <NodeViewWrapper
      className="code-block-body"
      data-language={language}
    >
      <div className="code-block-header" contentEditable={false}>
        {/* Label sizes to the selected language; the <select> overlays it
            invisibly so the picker stays functional without sizing the box
            to the widest option in the list. */}
        <div className="code-block-lang-wrap">
          <span className="code-block-lang-label">{label}</span>
          <select
            className="code-block-lang"
            value={language}
            disabled={!editor.isEditable}
            onChange={(e) => updateAttributes({ language: e.target.value })}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className={`code-block-icon-btn${wrap ? " active" : ""}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.isEditable && updateAttributes({ wrap: !wrap })}
          disabled={!editor.isEditable}
          aria-label={wrap ? "Disable word wrap" : "Enable word wrap"}
          aria-pressed={wrap}
        >
          <WrapText className="w-3.5 h-3.5" strokeWidth={2} />
        </button>
        <button
          type="button"
          className="code-block-icon-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onCopy}
          aria-label={copied ? "Copied" : "Copy"}
        >
          {copied ? <Check className="w-3.5 h-3.5" strokeWidth={2.5} /> : <Copy className="w-3.5 h-3.5" strokeWidth={2} />}
        </button>
      </div>
      <NodeViewContent<"code"> as="code" className={`language-${language}`} />
    </NodeViewWrapper>
  );
}
