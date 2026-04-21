import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";

/**
 * VideoBlock in the editor is just a spacer. The actual <video> element is a
 * single portal-rendered `PersistentVideoPlayer` owned by NoteCard that spans
 * hover → open → close with no remount. This component only reserves layout
 * space (matching aspect ratio) so text below lands correctly.
 */
export default function VideoBlockView({ node }: NodeViewProps) {
  const { aspect, poster } = node.attrs as {
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
        /* Poster as background-image so the HTML5 drag ghost (setDragImage
           snapshot) captures something. Using background-image instead of an
           <img> child keeps the wrapper's layout rect tight around the video
           area — an inline/replaced child can shift the rect via baseline /
           line-box rules. */
        backgroundImage: poster ? `url(${poster})` : undefined,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
      draggable={false}
    />
  );
}
