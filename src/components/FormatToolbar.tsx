import { forwardRef } from "react";
import type { Editor } from "@tiptap/react";
import { Bold, Italic, Underline as UnderlineIcon, Strikethrough, Code, Eraser, Link2, ExternalLink, Unlink, Check } from "lucide-react";

interface Props {
  editor: Editor | null;
  visible: boolean;
  linkMode: boolean;
  linkUrl: string;
  formatTooltips: boolean;
  linkTooltips: boolean;
  onEnterLinkMode: () => void;
  onApplyLink: () => void;
  onRemoveLink: () => void;
  onLinkUrlChange: (v: string) => void;
  onExitLinkMode: () => void;
  onSetFormatTooltips: (v: boolean) => void;
  onSetLinkTooltips: (v: boolean) => void;
}

const FormatToolbar = forwardRef<HTMLInputElement, Props>(
  (
    {
      editor,
      visible,
      linkMode,
      linkUrl,
      formatTooltips,
      linkTooltips,
      onEnterLinkMode,
      onApplyLink,
      onRemoveLink,
      onLinkUrlChange,
      onExitLinkMode,
      onSetFormatTooltips,
      onSetLinkTooltips,
    },
    linkInputRef,
  ) => {
    const showFormat = visible && !linkMode;
    const formatTransitionClass = showFormat
      ? "ease-[cubic-bezier(0,0,0.35,1)] bottom-10 scale-100 opacity-100 pointer-events-auto"
      : "ease-[cubic-bezier(0.65,0,1,1)] -bottom-24 scale-80 opacity-0 pointer-events-none";
    const linkTransitionClass = linkMode
      ? "ease-[cubic-bezier(0,0,0.35,1)] bottom-10 scale-100 opacity-100 pointer-events-auto"
      : "ease-[cubic-bezier(0.65,0,1,1)] -bottom-24 scale-80 opacity-0 pointer-events-none";

    const formatButtons = [
      { icon: Bold, label: "Bold", cmd: () => editor?.chain().focus().toggleBold().run(), active: editor?.isActive("bold"), shortcut: "⌘B" },
      { icon: Italic, label: "Italic", cmd: () => editor?.chain().focus().toggleItalic().run(), active: editor?.isActive("italic"), shortcut: "⌘I" },
      { icon: UnderlineIcon, label: "Underline", cmd: () => editor?.chain().focus().toggleUnderline().run(), active: editor?.isActive("underline"), shortcut: "⌘U" },
      { icon: Strikethrough, label: "Strikethrough", cmd: () => editor?.chain().focus().toggleStrike().run(), active: editor?.isActive("strike"), shortcut: "⌘⇧X" },
      { icon: Code, label: "Code", cmd: () => editor?.chain().focus().toggleCode().run(), active: editor?.isActive("code"), shortcut: "⌘E" },
      { icon: Link2, label: "Link", cmd: onEnterLinkMode, active: editor?.isActive("link"), shortcut: "⌘K" },
    ];

    const linkButtons = [
      { icon: Check, label: "Apply", cmd: onApplyLink },
      {
        icon: ExternalLink,
        label: "Open",
        cmd: () => {
          const u = linkUrl.trim();
          if (!u) return;
          const href = /^https?:\/\//.test(u) ? u : `https://${u}`;
          window.open(href, "_blank");
        },
      },
      { icon: Unlink, label: "Unlink", cmd: onRemoveLink },
    ];

    return (
      <>
        <div
          className={`floating-menu-bar fixed left-1/2 -translate-x-1/2 flex items-center gap-1 p-1.5 backdrop-blur-xl rounded-xl transition-all duration-300 z-10002 ${formatTransitionClass}`}
        >
          {formatButtons.map(({ icon: Icon, label, cmd, active, shortcut }, i) => (
            <div
              key={i}
              className="relative group flex flex-col items-center transition-transform duration-120 ease-out hover:scale-108"
              onMouseLeave={() => onSetFormatTooltips(true)}
            >
              <button
                onMouseDown={(e) => { e.preventDefault(); cmd(); }}
                className={`floating-btn ${active ? "is-active" : ""} w-10 h-10 rounded-lg flex items-center justify-center border-none cursor-pointer select-none`}
              >
                <Icon className="w-4 h-[18px]" strokeWidth={2.5} />
              </button>
              <div className={`floating-tooltip absolute bottom-full left-1/2 -translate-x-1/2 mb-3 px-2 py-1 rounded-lg text-[9px] font-semibold uppercase whitespace-nowrap opacity-0 ${formatTooltips ? "group-hover:opacity-100" : ""} pointer-events-none transition-opacity duration-150 shadow-lg flex items-center gap-2`}>
                <span>{label}</span>
                <span className="shortcut">{shortcut}</span>
              </div>
            </div>
          ))}
          <div
            className="relative group flex flex-col items-center transition-transform duration-120 ease-out hover:scale-110"
            onMouseLeave={() => onSetFormatTooltips(true)}
          >
            <button
              onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().unsetAllMarks().run(); }}
              className="floating-btn w-10 h-10 rounded-lg flex items-center justify-center border-none cursor-pointer select-none"
            >
              <Eraser className="w-4 h-[18px]" strokeWidth={2.5} />
            </button>
            <div className={`floating-tooltip absolute bottom-full left-1/2 -translate-x-1/2 mb-3 px-2 py-1 rounded-lg text-[9px] font-semibold uppercase whitespace-nowrap opacity-0 ${formatTooltips ? "group-hover:opacity-100" : ""} pointer-events-none transition-opacity duration-150 shadow-lg`}>
              Clear
            </div>
          </div>
        </div>
        <div
          className={`floating-menu-bar fixed left-1/2 -translate-x-1/2 flex items-center gap-1 p-1.5 backdrop-blur-xl rounded-xl transition-all duration-300 z-10002 ${linkTransitionClass}`}
        >
          <input
            ref={linkInputRef}
            type="text"
            value={linkUrl}
            onChange={(e) => onLinkUrlChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); onApplyLink(); }
              if (e.key === "Escape") { e.preventDefault(); onExitLinkMode(); editor?.commands.focus(); }
            }}
            placeholder="Paste link..."
            className="floating-input h-10 px-3 border-none outline-none text-sm w-[220px]"
          />
          {linkButtons.map(({ icon: Icon, label, cmd }, i) => (
            <div
              key={i}
              className="relative group flex flex-col items-center transition-transform duration-120 ease-out hover:scale-108"
              onMouseLeave={() => onSetLinkTooltips(true)}
            >
              <button
                onMouseDown={(e) => { e.preventDefault(); cmd(); }}
                className="floating-btn w-10 h-10 rounded-lg flex items-center justify-center border-none cursor-pointer select-none"
              >
                <Icon className="w-4 h-[18px]" strokeWidth={2.5} />
              </button>
              <div className={`floating-tooltip absolute bottom-full left-1/2 -translate-x-1/2 mb-3 px-2 py-1 rounded-lg text-[9px] font-semibold uppercase whitespace-nowrap opacity-0 ${linkTooltips ? "group-hover:opacity-100" : ""} pointer-events-none transition-opacity duration-150 shadow-lg`}>
                {label}
              </div>
            </div>
          ))}
        </div>
      </>
    );
  },
);

export default FormatToolbar;
