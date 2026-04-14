import React, { useMemo } from "react";
import type { NoteBlock } from "../store/db";
import { blocksToPreviewHtml } from "../lib/blockSerializer";

interface Props {
  blocks: NoteBlock[];
}

function NotePreview({ blocks }: Props) {
  const html = useMemo(() => blocksToPreviewHtml(blocks), [blocks]);

  return (
    <div className="note-editor">
      <div className="tiptap" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

export default React.memo(NotePreview);
