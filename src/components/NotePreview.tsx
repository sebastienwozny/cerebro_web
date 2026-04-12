import React, { useMemo } from "react";
import type { NoteBlock } from "../store/db";
import { blocksToPreviewHtml } from "../lib/blockSerializer";

interface Props {
  blocks: NoteBlock[];
  headerImageUrl?: string;
}

function NotePreview({ blocks, headerImageUrl }: Props) {
  const html = useMemo(() => blocksToPreviewHtml(blocks), [blocks]);

  return (
    <div className="note-editor">
      {headerImageUrl && (
        <div className="note-editor-header-image">
          <img src={headerImageUrl} alt="" />
        </div>
      )}
      <div className="tiptap" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

export default React.memo(NotePreview);
