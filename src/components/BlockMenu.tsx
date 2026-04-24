import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Type, RotateCcw, Copy, Trash2, Files } from "lucide-react";
import type { Editor } from "@tiptap/react";
import { BLOCK_DEFS, type BlockDef } from "../lib/blockRegistry";
import { useLockOverlayScroll } from "../hooks/useLockOverlayScroll";

const TURN_INTO_DEFS = BLOCK_DEFS.filter((d) => d.type !== "image" && d.type !== "video" && d.type !== "hr");

function getBlockDefAtPos(editor: Editor | null, pos: number | null): BlockDef {
  const text = BLOCK_DEFS[0];
  if (!editor || pos === null) return text;
  const $pos = editor.state.doc.resolve(pos);
  // When $pos sits between top-level children of doc (e.g. right at a leaf
  // block like <hr>), depth === 0 — look at nodeAfter to identify the block.
  if ($pos.depth === 0) {
    if ($pos.nodeAfter?.type.name === "horizontalRule") {
      return BLOCK_DEFS.find((b) => b.type === "hr") ?? text;
    }
    return text;
  }
  for (let d = $pos.depth; d >= 1; d--) {
    const name = $pos.node(d).type.name;
    if (name === "heading") {
      const level = $pos.node(d).attrs.level as number;
      const key = `heading${level}`;
      return BLOCK_DEFS.find((b) => b.type === key) ?? text;
    }
    if (name === "bulletList") return BLOCK_DEFS.find((b) => b.type === "bulletList") ?? text;
    if (name === "orderedList") return BLOCK_DEFS.find((b) => b.type === "orderedList") ?? text;
    if (name === "taskList") return BLOCK_DEFS.find((b) => b.type === "todo") ?? text;
    if (name === "blockquote") return BLOCK_DEFS.find((b) => b.type === "quote") ?? text;
    if (name === "codeBlock") return BLOCK_DEFS.find((b) => b.type === "codeBlock") ?? text;
    if (name === "horizontalRule") return BLOCK_DEFS.find((b) => b.type === "hr") ?? text;
  }
  return text;
}

interface Props {
  x: number;
  y: number;
  editor: Editor | null;
  blockPos: number | null;
  onTurnInto: (def: BlockDef) => void;
  onResetFormatting: () => void;
  onDuplicate: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export default function BlockMenu({
  x,
  y,
  editor,
  blockPos,
  onTurnInto,
  onResetFormatting,
  onDuplicate,
  onCopy,
  onDelete,
  onClose,
}: Props) {
  const currentDef = useMemo(() => getBlockDefAtPos(editor, blockPos), [editor, blockPos]);
  const menuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const [showSubmenu, setShowSubmenu] = useState(false);
  const [submenuFlipLeft, setSubmenuFlipLeft] = useState(false);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", handleClick, true);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("pointerdown", handleClick, true);
      window.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  useLockOverlayScroll();

  // Keep main menu inside viewport
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    if (rect.right > window.innerWidth - pad) el.style.left = `${x - rect.width}px`;
    if (rect.bottom > window.innerHeight - pad) el.style.top = `${y - rect.height}px`;
  }, [x, y]);

  // Flip submenu left if it would overflow the right edge
  useLayoutEffect(() => {
    if (!showSubmenu || !submenuRef.current || !menuRef.current) return;
    const menuRect = menuRef.current.getBoundingClientRect();
    const submenuWidth = submenuRef.current.getBoundingClientRect().width;
    setSubmenuFlipLeft(menuRect.right + 4 + submenuWidth > window.innerWidth - 8);
  }, [showSubmenu]);

  return createPortal(
    <div
      ref={menuRef}
      className="floating-menu-dropdown fixed flex flex-col py-1.5 backdrop-blur-xl rounded-xl z-(--z-context-menu) min-w-[200px]"
      style={{ left: x, top: y }}
    >
      <span className="floating-label px-3 pt-1.5 pb-2 text-[13px] font-medium">
        {currentDef.label}
      </span>
      <div className="floating-divider mb-1" />

      {currentDef.type !== "hr" && (
        <>
          {/* Turn into — shows submenu on hover */}
          <div
            className="relative"
            onMouseEnter={() => setShowSubmenu(true)}
            onMouseLeave={() => setShowSubmenu(false)}
          >
            <button className="floating-item flex items-center gap-3 px-3 py-2 mx-1.5 rounded-lg border-none cursor-pointer select-none w-full bg-transparent transition-colors duration-100">
              <Type className="w-4 h-4 shrink-0" strokeWidth={2} />
              <span className="text-[13px] flex-1 text-left">Turn into</span>
              <ChevronRight className="w-3.5 h-3.5 shrink-0 opacity-50" strokeWidth={2} />
            </button>
            {showSubmenu && (
              <div
                ref={submenuRef}
                className="floating-menu-dropdown absolute top-0 flex flex-col py-1.5 backdrop-blur-xl rounded-xl z-(--z-context-menu) min-w-[200px]"
                style={submenuFlipLeft ? { right: "calc(100% + 4px)" } : { left: "calc(100% + 4px)" }}
              >
                {TURN_INTO_DEFS.map((def) => {
                  const Icon = def.icon;
                  return (
                    <button
                      key={def.type}
                      className="floating-item flex items-center gap-3 px-3 py-2 mx-1.5 rounded-lg border-none cursor-pointer select-none bg-transparent transition-colors duration-100"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        onTurnInto(def);
                        onClose();
                      }}
                    >
                      <Icon className="w-4 h-4 shrink-0" strokeWidth={2} />
                      <span className="text-[13px] flex-1 text-left">{def.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <button
            className="floating-item flex items-center gap-3 px-3 py-2 mx-1.5 rounded-lg border-none cursor-pointer select-none bg-transparent transition-colors duration-100"
            onMouseDown={(e) => {
              e.preventDefault();
              onResetFormatting();
              onClose();
            }}
          >
            <RotateCcw className="w-4 h-4 shrink-0" strokeWidth={2} />
            <span className="text-[13px] flex-1 text-left">Reset formatting</span>
          </button>

          <div className="floating-divider my-1" />
        </>
      )}

      <button
        className="floating-item flex items-center gap-3 px-3 py-2 mx-1.5 rounded-lg border-none cursor-pointer select-none bg-transparent transition-colors duration-100"
        onMouseDown={(e) => {
          e.preventDefault();
          onDuplicate();
          onClose();
        }}
      >
        <Files className="w-4 h-4 shrink-0" strokeWidth={2} />
        <span className="text-[13px] flex-1 text-left">Duplicate</span>
      </button>

      <button
        className="floating-item flex items-center gap-3 px-3 py-2 mx-1.5 rounded-lg border-none cursor-pointer select-none bg-transparent transition-colors duration-100"
        onMouseDown={(e) => {
          e.preventDefault();
          onCopy();
          onClose();
        }}
      >
        <Copy className="w-4 h-4 shrink-0" strokeWidth={2} />
        <span className="text-[13px] flex-1 text-left">Copy</span>
      </button>

      <div className="floating-divider my-1" />

      <button
        className="floating-item flex items-center gap-3 px-3 py-2 mx-1.5 rounded-lg border-none cursor-pointer select-none bg-transparent transition-colors duration-100 text-red-400 hover:bg-red-500/15"
        onMouseDown={(e) => {
          e.preventDefault();
          onDelete();
          onClose();
        }}
      >
        <Trash2 className="w-4 h-4 shrink-0" strokeWidth={2} />
        <span className="text-[13px] flex-1 text-left">Delete</span>
      </button>
    </div>,
    document.body,
  );
}
