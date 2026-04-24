import { Download, Copy, Files, Trash2 } from "lucide-react";
import ToolbarButton from "./ToolbarButton";

interface Props {
  visible: boolean;
  tooltipsEnabled: boolean;
  onSetTooltipsEnabled: (v: boolean) => void;
  onDownload: () => void;
  onDuplicate: () => void;
  onCopy: () => void;
  onDelete: () => void;
}

export default function MediaToolbar({
  visible,
  tooltipsEnabled,
  onSetTooltipsEnabled,
  onDownload,
  onDuplicate,
  onCopy,
  onDelete,
}: Props) {
  const transitionClass = visible
    ? "ease-[cubic-bezier(0,0,0.35,1)] bottom-10 scale-100 opacity-100 pointer-events-auto"
    : "ease-[cubic-bezier(0.65,0,1,1)] -bottom-24 scale-80 opacity-0 pointer-events-none";

  const buttons = [
    { icon: Download, label: "Download", cmd: onDownload },
    { icon: Files, label: "Duplicate", cmd: onDuplicate },
    { icon: Copy, label: "Copy", cmd: onCopy },
    { icon: Trash2, label: "Delete", cmd: onDelete },
  ];

  return (
    <div
      className={`floating-menu-bar fixed left-1/2 -translate-x-1/2 flex items-center gap-1 p-1.5 backdrop-blur-xl rounded-xl transition-all duration-300 z-(--z-toolbar) ${transitionClass}`}
    >
      {buttons.map((b, i) => (
        <ToolbarButton
          key={i}
          icon={b.icon}
          label={b.label}
          tooltipsEnabled={tooltipsEnabled}
          onSetTooltipsEnabled={onSetTooltipsEnabled}
          onClick={b.cmd}
        />
      ))}
    </div>
  );
}
