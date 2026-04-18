import { ReactNodeViewRenderer } from "@tiptap/react";
import BaseImage from "@tiptap/extension-image";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { createLowlight, common } from "lowlight";
import CodeBlockView from "../../components/CodeBlockView";

const lowlight = createLowlight(common);

// CodeBlock with syntax highlighting + custom React NodeView (language picker,
// copy button). Replaces StarterKit's default codeBlock. `as: 'pre'` makes the
// outer NodeView element a <pre> so styling and handle positioning mirror a
// plain code block (no nested wrapper div).
export const CodeBlockWithView = CodeBlockLowlight.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      wrap: {
        default: false,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-wrap") === "true",
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.wrap ? { "data-wrap": "true" } : {},
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView, { as: "pre" });
  },
}).configure({
  lowlight,
  defaultLanguage: "plaintext",
});

// Extend Tiptap Image to carry aspect ratio
export const ImageWithAspect = BaseImage.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      aspect: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const v = el.getAttribute("data-aspect");
          return v ? parseFloat(v) : null;
        },
        renderHTML: (attrs: Record<string, unknown>) => {
          if (!attrs.aspect) return {};
          return { "data-aspect": String(attrs.aspect) };
        },
      },
    };
  },
});
