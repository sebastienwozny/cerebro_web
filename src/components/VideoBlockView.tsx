import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";

/**
 * VideoBlock in the editor.
 *
 * First block (pos === 1): just a spacer — PersistentVideoPlayer overlays it
 * exactly and handles all rendering/playback across hover → open → close.
 *
 * Any other position: render a real <video> with native controls. The poster
 * is shown until the user interacts.
 */
export default function VideoBlockView({ node, getPos, selected }: NodeViewProps) {
  const { src, poster, aspect } = node.attrs as {
    src: string | null;
    poster: string | null;
    aspect: number | null;
    mimeType: string | null;
  };

  const aspectCss = aspect && aspect > 0 ? `1 / ${aspect}` : "16 / 9";
  const pos = typeof getPos === "function" ? getPos() : -1;
  const isHeaderBlock = pos === 1;

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
        backgroundImage: poster ? `url(${poster})` : undefined,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
      draggable={false}
    />
  );
}
