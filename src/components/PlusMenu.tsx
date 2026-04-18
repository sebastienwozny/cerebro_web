import { forwardRef, useLayoutEffect, useRef, useState } from "react";
import { BLOCK_DEFS, type BlockDef } from "../lib/blockRegistry";

interface Props {
  contentLeft: number;
  lineBottom: number;
  lineH: number;
  flipUp: boolean;
  onSelect: (def: BlockDef) => void;
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
      className="floating-menu-dropdown fixed flex flex-col py-1 backdrop-blur-xl rounded-xl z-(--z-plus-menu) min-w-[300px]"
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
        {BLOCK_DEFS.map((def, i) => {
          const Icon = def.icon;
          return (
            <button
              key={def.type}
              data-plus-item
              className="floating-item flex items-center gap-3 px-3 py-1.5 mx-1 rounded-lg border-none cursor-pointer select-none"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(def);
              }}
              onMouseEnter={() => onHoverItem(i)}
            >
              <Icon className="w-4 h-4 shrink-0" strokeWidth={2} />
              <span className="text-[14px] flex-1 text-left">{def.label}</span>
              {def.slashShortcut && (
                <span className="floating-shortcut text-[11px] ml-4 font-semibold tracking-wide">
                  {def.slashShortcut}
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
        onMouseEnter={() => onHoverItem(BLOCK_DEFS.length)}
      >
        <span className="text-[14px] flex-1 text-left">Close</span>
        <span className="floating-shortcut text-[11px] font-semibold tracking-wide">Esc</span>
      </button>
    </div>
    );
  },
);

export default PlusMenu;
