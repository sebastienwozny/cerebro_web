import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  MousePointerClick,
  Copy,
  Trash2,
  Layers,
  LayoutGrid,
  BoxSelect,
} from "lucide-react";

const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
const MOD = isMac ? "⌘" : "Ctrl+";

interface MenuItem {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  shortcut?: string;
  action: () => void;
  danger?: boolean;
  disabled?: boolean;
  hidden?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

export type { MenuItem };

export default function ContextMenu({ x, y, items, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside or Escape
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Use capture to catch clicks before they propagate
    window.addEventListener("pointerdown", handleClick, true);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("pointerdown", handleClick, true);
      window.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  // Adjust position so menu stays within viewport
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const pad = 8;
    if (rect.right > window.innerWidth - pad) {
      menuRef.current.style.left = `${x - rect.width}px`;
    }
    if (rect.bottom > window.innerHeight - pad) {
      menuRef.current.style.top = `${y - rect.height}px`;
    }
  }, [x, y]);

  const visibleItems = items.filter((item) => !item.hidden);

  return createPortal(
    <div
      ref={menuRef}
      className="fixed flex flex-col py-1.5 backdrop-blur-xl rounded-xl border border-white/8"
      style={{
        left: x,
        top: y,
        zIndex: 10003,
        background: "#1a1c1e",
        boxShadow:
          "0 20px 25px -5px rgba(0,0,0,0.3), 0 8px 10px -6px rgba(0,0,0,0.3), 0 40px 80px -20px rgba(0,0,0,0.25)",
        minWidth: 200,
      }}
    >
      {visibleItems.map((item, i) => {
        const Icon = item.icon;
        return (
          <button
            key={i}
            className={`flex items-center gap-3 px-3 py-2 mx-1.5 rounded-lg border-none cursor-pointer select-none transition-colors duration-100
              ${item.disabled ? "opacity-40 pointer-events-none" : ""}
              ${item.danger ? "text-red-400 hover:bg-red-500/15" : "text-neutral-300 hover:bg-white/8 hover:text-white"}`}
            style={{ background: "transparent" }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!item.disabled) {
                item.action();
                onClose();
              }
            }}
          >
            <Icon className="w-4 h-4 shrink-0" strokeWidth={2} />
            <span className="text-[13px] flex-1 text-left">{item.label}</span>
            {item.shortcut && (
              <span className="text-[11px] text-white/40 ml-4 font-semibold tracking-wide">
                {item.shortcut}
              </span>
            )}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

export { MOD };
