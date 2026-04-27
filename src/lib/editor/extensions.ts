import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import BaseImage from "@tiptap/extension-image";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { createLowlight, common } from "lowlight";
import CodeBlockView from "../../components/CodeBlockView";
import VideoBlockView from "../../components/VideoBlockView";

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

// Native <video> block. The underlying Blob isn't stored in the document —
// only `blockId` (a stable UUID the save path uses to reattach the Blob) and
// `src` (an object URL created by the editor wrapper). Poster, aspect, and
// MIME type round-trip through attrs so the serializer doesn't need a
// separate metadata map.
export const VideoBlock = Node.create({
  name: "video",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (el) => el.getAttribute("src"),
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.src ? { src: String(attrs.src) } : {},
      },
      blockId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-block-id"),
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.blockId ? { "data-block-id": String(attrs.blockId) } : {},
      },
      poster: {
        default: null,
        parseHTML: (el) => el.getAttribute("poster"),
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.poster ? { poster: String(attrs.poster) } : {},
      },
      aspect: {
        default: null,
        parseHTML: (el) => {
          const v = el.getAttribute("data-aspect");
          return v ? parseFloat(v) : null;
        },
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.aspect ? { "data-aspect": String(attrs.aspect) } : {},
      },
      mimeType: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-mime"),
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.mimeType ? { "data-mime": String(attrs.mimeType) } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "video[data-block-id]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["video", mergeAttributes(HTMLAttributes, { controls: "true" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(VideoBlockView, { as: "div" });
  },
});

// Extend Tiptap Image to carry aspect ratio + source URL (for screenshot
// cards captured from arbitrary web pages — used by NoteCard to flag
// the card as a "URL screenshot" and drop the rounded corners).
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
      sourceUrl: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-source-url"),
        renderHTML: (attrs: Record<string, unknown>) => {
          if (!attrs.sourceUrl) return {};
          return { "data-source-url": String(attrs.sourceUrl) };
        },
      },
      // The originating NoteBlock id. Round-tripped through HTML so
      // htmlToBlocks can re-attach the Blob from the editor's image
      // map (URL.createObjectURL strings aren't a stable source-of-
      // truth; the map is).
      blockId: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-block-id"),
        renderHTML: (attrs: Record<string, unknown>) => {
          if (!attrs.blockId) return {};
          return { "data-block-id": String(attrs.blockId) };
        },
      },
    };
  },
});
