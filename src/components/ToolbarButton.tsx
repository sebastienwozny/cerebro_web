import type { ComponentType } from "react";

interface Props {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  shortcut?: string;
  active?: boolean;
  tooltipsEnabled: boolean;
  onSetTooltipsEnabled: (v: boolean) => void;
  onClick: () => void;
}

export default function ToolbarButton({
  icon: Icon,
  label,
  shortcut,
  active,
  tooltipsEnabled,
  onSetTooltipsEnabled,
  onClick,
}: Props) {
  return (
    <div
      className="relative group flex flex-col items-center transition-transform duration-120 ease-out hover:scale-108"
      onMouseLeave={() => onSetTooltipsEnabled(true)}
    >
      <button
        onMouseDown={(e) => {
          e.preventDefault();
          onClick();
        }}
        className={`floating-btn ${active ? "is-active" : ""} w-10 h-10 rounded-lg flex items-center justify-center border-none cursor-pointer select-none`}
      >
        <Icon className="w-4 h-[18px]" strokeWidth={2.5} />
      </button>
      <div
        className={`app-tooltip floating-tooltip ${shortcut ? "flex items-center gap-2" : ""} ${tooltipsEnabled ? "group-hover:opacity-100" : ""}`}
      >
        <span>{label}</span>
        {shortcut && <span className="shortcut">{shortcut}</span>}
      </div>
    </div>
  );
}
