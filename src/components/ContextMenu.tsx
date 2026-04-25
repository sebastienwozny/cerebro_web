import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useMenuDismiss } from "../hooks/useMenuDismiss";

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

  useMenuDismiss([menuRef], onClose);

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
      className="floating-menu-dropdown fixed flex flex-col py-1.5 backdrop-blur-xl rounded-xl z-(--z-context-menu) min-w-[200px]"
      style={{ left: x, top: y }}
    >
      {visibleItems.map((item, i) => {
        const Icon = item.icon;
        return (
          <button
            key={i}
            className={`floating-item flex items-center gap-3 px-3 py-2 mx-1.5 rounded-lg border-none cursor-pointer select-none transition-colors duration-100 bg-transparent
              ${item.disabled ? "opacity-40 pointer-events-none" : ""}
              ${item.danger ? "text-red-400 hover:bg-red-500/15" : ""}`}
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
              <span className="floating-shortcut text-[11px] ml-4 font-semibold tracking-wide">
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
