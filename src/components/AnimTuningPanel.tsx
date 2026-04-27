import { useState } from "react";
import type { AnimTuning } from "../hooks/useOpenClose";

const EASE_PRESETS = [
  "linear",
  "power1.in", "power1.out", "power1.inOut",
  "power2.in", "power2.out", "power2.inOut",
  "power3.in", "power3.out", "power3.inOut",
  "power4.in", "power4.out", "power4.inOut",
  "back.in", "back.out", "back.inOut",
  "expo.in", "expo.out", "expo.inOut",
  "circ.in", "circ.out", "circ.inOut",
  "sine.in", "sine.out", "sine.inOut",
];

interface Props {
  value: AnimTuning;
  onChange: (next: AnimTuning) => void;
}

/** Floating dev panel for tuning the open/close animation timing + easing
 *  on the fly. Toggle via the small ⚙️ button in the bottom-left. */
export default function AnimTuningPanel({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const update = (patch: Partial<AnimTuning>) => onChange({ ...value, ...patch });

  return (
    <>
      <button
        onClick={() => setOpen(o => !o)}
        title="Animation tuning"
        className="fixed bottom-6 left-6 w-10 h-10 rounded-full flex items-center justify-center cursor-pointer border-none select-none bg-card text-text-muted shadow-fab z-(--z-fab)"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      {open && (
        <div
          className="fixed bottom-20 left-6 bg-card text-text-primary rounded-xl shadow-fab p-4 z-(--z-fab) text-sm flex flex-col gap-3"
          style={{ width: 320 }}
        >
          <div className="font-semibold text-text-primary">Animation tuning</div>

          <Row label="Open duration">
            <input
              type="range"
              min={0.1}
              max={1.5}
              step={0.05}
              value={value.openDuration}
              onChange={(e) => update({ openDuration: Number(e.target.value) })}
              className="flex-1"
            />
            <span className="w-12 text-right text-text-muted">{value.openDuration.toFixed(2)}s</span>
          </Row>

          <Row label="Open ease">
            <select
              value={value.openEase}
              onChange={(e) => update({ openEase: e.target.value })}
              className="flex-1 bg-floating-bg text-text-primary rounded px-2 py-1 outline-none"
            >
              {EASE_PRESETS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </Row>

          <Row label="Close duration">
            <input
              type="range"
              min={0.1}
              max={1.5}
              step={0.05}
              value={value.closeDuration}
              onChange={(e) => update({ closeDuration: Number(e.target.value) })}
              className="flex-1"
            />
            <span className="w-12 text-right text-text-muted">{value.closeDuration.toFixed(2)}s</span>
          </Row>

          <Row label="Close ease">
            <select
              value={value.closeEase}
              onChange={(e) => update({ closeEase: e.target.value })}
              className="flex-1 bg-floating-bg text-text-primary rounded px-2 py-1 outline-none"
            >
              {EASE_PRESETS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </Row>
        </div>
      )}
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-text-muted text-xs">{label}</div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}
