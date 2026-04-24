import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import type { Editor } from "@tiptap/react";
import { BLOCK_DEFS, type BlockDef } from "../lib/blockRegistry";

const TURN_INTO_DEFS = BLOCK_DEFS.filter(
  (d) => d.type !== "image" && d.type !== "video" && d.type !== "hr",
);

function getCurrentBlockDef(editor: Editor | null): BlockDef {
  const text = BLOCK_DEFS[0];
  if (!editor) return text;
  if (editor.isActive("heading", { level: 1 })) return BLOCK_DEFS.find((d) => d.type === "heading1") ?? text;
  if (editor.isActive("heading", { level: 2 })) return BLOCK_DEFS.find((d) => d.type === "heading2") ?? text;
  if (editor.isActive("heading", { level: 3 })) return BLOCK_DEFS.find((d) => d.type === "heading3") ?? text;
  if (editor.isActive("bulletList")) return BLOCK_DEFS.find((d) => d.type === "bulletList") ?? text;
  if (editor.isActive("orderedList")) return BLOCK_DEFS.find((d) => d.type === "orderedList") ?? text;
  if (editor.isActive("taskList")) return BLOCK_DEFS.find((d) => d.type === "todo") ?? text;
  if (editor.isActive("blockquote")) return BLOCK_DEFS.find((d) => d.type === "quote") ?? text;
  if (editor.isActive("codeBlock")) return BLOCK_DEFS.find((d) => d.type === "codeBlock") ?? text;
  return text;
}

interface Props {
  editor: Editor | null;
  visible: boolean;
  tooltipsEnabled: boolean;
  onSetTooltipsEnabled: (v: boolean) => void;
}

export default function TurnIntoButton({ editor, visible, tooltipsEnabled, onSetTooltipsEnabled }: Props) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null);
  const [, forceRender] = useState({});

  // Re-render on selection/transaction so current block type stays in sync.
  useEffect(() => {
    if (!editor) return;
    const handler = () => forceRender({});
    editor.on("selectionUpdate", handler);
    editor.on("transaction", handler);
    return () => {
      editor.off("selectionUpdate", handler);
      editor.off("transaction", handler);
    };
  }, [editor]);

  // Close the dropdown when the toolbar hides (selection cleared, link mode, etc.)
  useEffect(() => {
    if (!visible) setOpen(false);
  }, [visible]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", handleClick, true);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("pointerdown", handleClick, true);
      window.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  // Position the dropdown above the button, centered horizontally.
  useLayoutEffect(() => {
    if (!open || !btnRef.current || !menuRef.current) {
      setMenuPos(null);
      return;
    }
    const btnRect = btnRef.current.getBoundingClientRect();
    const menuRect = menuRef.current.getBoundingClientRect();
    let left = btnRect.left + btnRect.width / 2 - menuRect.width / 2;
    const pad = 8;
    left = Math.max(pad, Math.min(left, window.innerWidth - menuRect.width - pad));
    const top = btnRect.top - menuRect.height - 6;
    setMenuPos({ left, top });
  }, [open]);

  const currentDef = getCurrentBlockDef(editor);
  const CurrentIcon = currentDef.icon;

  const handleSelect = (def: BlockDef) => {
    if (!editor) return;
    def.apply?.(editor);
    setOpen(false);
  };

  return (
    <>
      <div
        className="relative group flex flex-col items-center transition-transform duration-120 ease-out hover:scale-108"
        onMouseLeave={() => onSetTooltipsEnabled(true)}
      >
        <button
          ref={btnRef}
          onMouseDown={(e) => {
            e.preventDefault();
            setOpen((v) => !v);
          }}
          className={`floating-btn ${open ? "is-active" : ""} h-10 px-2.5 rounded-lg flex items-center gap-1 border-none cursor-pointer select-none`}
        >
          <CurrentIcon className="w-4 h-[18px]" strokeWidth={2.5} />
          <ChevronDown className="w-3 h-3 opacity-60" strokeWidth={2.5} />
        </button>
        <div
          className={`app-tooltip floating-tooltip ${tooltipsEnabled && !open ? "group-hover:opacity-100" : ""}`}
        >
          <span>Turn into</span>
        </div>
      </div>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="floating-menu-dropdown fixed flex flex-col py-1.5 backdrop-blur-xl rounded-xl z-(--z-context-menu) min-w-[200px]"
            style={{
              left: menuPos?.left ?? -9999,
              top: menuPos?.top ?? -9999,
              visibility: menuPos ? "visible" : "hidden",
            }}
          >
            {TURN_INTO_DEFS.map((def) => {
              const Icon = def.icon;
              const isActive = def.type === currentDef.type;
              return (
                <button
                  key={def.type}
                  className={`floating-item flex items-center gap-3 px-3 py-2 mx-1.5 rounded-lg border-none cursor-pointer select-none bg-transparent transition-colors duration-100 ${isActive ? "active" : ""}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelect(def);
                  }}
                >
                  <Icon className="w-4 h-4 shrink-0" strokeWidth={2} />
                  <span className="text-[13px] flex-1 text-left">{def.label}</span>
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
