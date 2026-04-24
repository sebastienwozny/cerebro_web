import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";

/**
 * VideoBlock in the editor.
 *
 * First block (pos === 1): just a spacer — PersistentVideoPlayer overlays it
 * exactly and handles all rendering/playback across hover → open → close.
 *
 * Any other position: render a real <video> with native controls. The poster
 * is shown until the user interacts.
 */
export default function VideoBlockView({ node, getPos, selected, editor }: NodeViewProps) {
  const { src, poster, aspect } = node.attrs as {
    src: string | null;
    poster: string | null;
    aspect: number | null;
    mimeType: string | null;
  };

  const aspectCss = aspect && aspect > 0 ? `1 / ${aspect}` : "16 / 9";
  const pos = typeof getPos === "function" ? getPos() : -1;
  // Header = first child of the doc — PVP overlays this block. Match by
  // blockId (unique) rather than a magic pos value since positions can shift
  // after edits/undo (e.g. leading empty paragraphs being re-inserted).
  const firstChild = editor.state.doc.firstChild;
  const isHeaderBlock =
    firstChild?.type.name === "video" &&
    firstChild.attrs.blockId === node.attrs.blockId;

  // Native <video controls> swallows its own clicks (shadow-DOM controls), so
  // clicking the video doesn't create a NodeSelection via ProseMirror's usual
  // path. Force-select on mousedown so the media toolbar can trigger.
  const handleMouseDown = () => {
    if (pos < 0) return;
    const cur = editor.state.selection;
    if (cur instanceof NodeSelection && cur.from === pos) return;
    editor.chain().setNodeSelection(pos).run();
  };

  if (!isHeaderBlock && src) {
    return (
      <NodeViewWrapper
        as="div"
        contentEditable={false}
        className="video-block-wrap"
        style={{
          width: "100%",
          aspectRatio: aspectCss,
          borderRadius: 6,
          overflow: "hidden",
          boxShadow: selected ? "0 0 0 3px var(--color-selection-border)" : undefined,
          transition: "box-shadow 150ms ease-out",
        }}
        draggable={false}
        onMouseDown={handleMouseDown}
      >
        <video
          src={src}
          poster={poster ?? undefined}
          controls
          playsInline
          preload="metadata"
          style={{ width: "100%", height: "100%", display: "block", objectFit: "cover" }}
        />
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      as="div"
      contentEditable={false}
      className="video-block-wrap"
      style={{
        width: "100%",
        aspectRatio: aspectCss,
        borderRadius: 6,
        // No backgroundImage — PVP covers this spacer entirely. Showing the
        // poster here meant that when PVP was transiently mispositioned (e.g.
        // immediately after undo of a delete), the stale poster appeared as
        // a second "video" stacked with PVP.
      }}
      draggable={false}
    />
  );
}
