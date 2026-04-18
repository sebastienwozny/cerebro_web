import { forwardRef, useLayoutEffect, useRef, useState } from "react";
import { Type, Heading1, Heading2, Heading3, List, ListOrdered, ListChecks, Quote, Code, Minus, ImageIcon } from "lucide-react";
import { SLASH_COMMANDS } from "../lib/slashCommands";

const META: Record<string, { icon: typeof Type; shortcut: string }> = {
  text:        { icon: Type,        shortcut: "" },
  heading1:    { icon: Heading1,    shortcut: "#" },
  heading2:    { icon: Heading2,    shortcut: "##" },
  heading3:    { icon: Heading3,    shortcut: "###" },
  bulletList:  { icon: List,        shortcut: "-" },
  orderedList: { icon: ListOrdered, shortcut: "1." },
  todo:        { icon: ListChecks,  shortcut: "[]" },
  quote:       { icon: Quote,       shortcut: ">" },
  codeBlock:   { icon: Code,        shortcut: "```" },
  hr:          { icon: Minus,       shortcut: "---" },
  image:       { icon: ImageIcon,   shortcut: "/image" },
};

interface Props {
  contentLeft: number;
  lineBottom: number;
  lineH: number;
  flipUp: boolean;
  onSelect: (cmd: (typeof SLASH_COMMANDS)[number]) => void;
  onClose: () => void;
  onHoverItem: (index: number) => void;
}

const PlusMenu = forwardRef<HTMLDivElement, Props>(
  ({ contentLeft, lineBottom, lineH, flipUp, onSelect, onClose, onHoverItem }, ref) => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [fadeTop, setFadeTop] = useState(false);
    const [fadeBottom, setFadeBottom] = useState(false);
    const updateFades = () => {
      const el = scrollRef.current;
      if (!el) return;
      setFadeTop(el.scrollTop > 0);
      setFadeBottom(el.scrollTop + el.clientHeight < el.scrollHeight - 1);
    };
    useLayoutEffect(updateFades, []);
    return (
    <div
      ref={ref}
      className="floating-menu-dropdown fixed flex flex-col py-1 backdrop-blur-xl rounded-xl z-10005 min-w-[300px]"
      style={{
        left: contentLeft,
        top: lineBottom + 8,
        transform: flipUp ? `translateY(calc(-100% - ${lineH + 16}px))` : undefined,
      }}
    >
      <span className="floating-label px-3 pt-2.5 pb-2 text-[11px] font-semibold uppercase tracking-wider">
        Insert block
      </span>
      <div className="relative">
        <div
          ref={scrollRef}
          onScroll={updateFades}
          className="flex flex-col max-h-[260px] overflow-y-auto"
        >
        {SLASH_COMMANDS.map((cmd, i) => {
          const meta = META[cmd.type] ?? { icon: Type, shortcut: "" };
          const Icon = meta.icon;
          return (
            <button
              key={cmd.type}
              data-plus-item
              className="floating-item flex items-center gap-3 px-3 py-1.5 mx-1 rounded-lg border-none cursor-pointer select-none"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(cmd);
              }}
              onMouseEnter={() => onHoverItem(i)}
            >
              <Icon className="w-4 h-4 shrink-0" strokeWidth={2} />
              <span className="text-[14px] flex-1 text-left">{cmd.label}</span>
              {meta.shortcut && (
                <span className="floating-shortcut text-[11px] ml-4 font-semibold tracking-wide">
                  {meta.shortcut}
                </span>
              )}
            </button>
          );
        })}
        </div>
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-6 plus-menu-fade-top transition-opacity duration-150"
          style={{ opacity: fadeTop ? 1 : 0 }}
        />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-6 plus-menu-fade-bottom transition-opacity duration-150"
          style={{ opacity: fadeBottom ? 1 : 0 }}
        />
      </div>
      <div className="floating-divider my-1" />
      <button
        data-plus-item
        className="floating-item flex items-center gap-3 px-3 py-1.5 mx-1 rounded-lg border-none cursor-pointer select-none"
        onMouseDown={(e) => {
          e.preventDefault();
          onClose();
        }}
        onMouseEnter={() => onHoverItem(SLASH_COMMANDS.length)}
      >
        <span className="text-[14px] flex-1 text-left">Close</span>
        <span className="floating-shortcut text-[11px] font-semibold tracking-wide">Esc</span>
      </button>
    </div>
    );
  },
);

export default PlusMenu;
