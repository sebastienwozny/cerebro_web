import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";

/**
 * VideoBlock in the editor is just a spacer. The actual <video> element is a
 * single portal-rendered `PersistentVideoPlayer` owned by NoteCard that spans
 * hover → open → close with no remount. This component only reserves layout
 * space (matching aspect ratio) so text below lands correctly.
 */
export default function VideoBlockView({ node }: NodeViewProps) {
  const { aspect } = node.attrs as {
    src: string | null;
    poster: string | null;
    aspect: number | null;
    mimeType: string | null;
  };

  const aspectCss = aspect && aspect > 0 ? `1 / ${aspect}` : "16 / 9";

  return (
    <NodeViewWrapper
      as="div"
      contentEditable={false}
      className="video-block-wrap"
      style={{
        width: "100%",
        aspectRatio: aspectCss,
        borderRadius: 6,
      }}
      draggable={false}
    />
  );
}
