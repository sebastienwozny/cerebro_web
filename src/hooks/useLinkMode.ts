import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";

export function useLinkMode(editor: Editor | null, onDone?: () => void) {
  const [linkMode, setLinkMode] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkTooltips, setLinkTooltips] = useState(false);
  const linkInputRef = useRef<HTMLInputElement>(null);
  // Distinguishes "user opened link mode via ⌘K / toolbar button" from
  // "cursor happens to be on a link" — only the latter auto-exits on selection
  // change so the manual input doesn't close itself when focus lands on the
  // input (which moves the ProseMirror selection off the link).
  const linkManualRef = useRef(false);

  useEffect(() => {
    if (linkMode) {
      linkInputRef.current?.focus();
      setLinkTooltips(false);
    }
  }, [linkMode]);

  const enterLinkMode = useCallback(() => {
    if (!editor) return;
    const href = editor.isActive("link") ? editor.getAttributes("link").href || "" : "";
    setLinkUrl(href);
    setLinkMode(true);
    linkManualRef.current = true;
  }, [editor]);

  const exitLinkMode = useCallback(() => {
    setLinkMode(false);
    setLinkUrl("");
    linkManualRef.current = false;
  }, []);

  const applyLink = useCallback(() => {
    if (!editor) return;
    const url = linkUrl.trim();
    if (url) {
      const href = /^https?:\/\//.test(url) ? url : `https://${url}`;
      editor.chain().focus().setLink({ href }).run();
    } else {
      editor.chain().focus().unsetLink().run();
    }
    exitLinkMode();
    onDone?.();
  }, [editor, linkUrl, exitLinkMode, onDone]);

  const removeLink = useCallback(() => {
    if (!editor) return;
    editor.chain().focus().unsetLink().run();
    exitLinkMode();
    onDone?.();
  }, [editor, exitLinkMode, onDone]);

  // Call from editor's onSelectionUpdate with `editor.isActive("link")`.
  // Auto-exits link mode when cursor moves off a link (unless the user
  // manually opened the input).
  const onSelectionChange = useCallback((isLinkActive: boolean) => {
    if (!isLinkActive && !linkManualRef.current) {
      setLinkMode(false);
      setLinkUrl("");
    }
  }, []);

  return {
    linkMode,
    linkUrl,
    setLinkUrl,
    linkTooltips,
    setLinkTooltips,
    linkInputRef,
    enterLinkMode,
    exitLinkMode,
    applyLink,
    removeLink,
    onSelectionChange,
  };
}
