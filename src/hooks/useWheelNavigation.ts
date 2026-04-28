import { useGesture } from "@use-gesture/react";
import { PAN_MULTIPLIER, ZOOM_SENSITIVITY } from "../constants";

/** Canvas wheel + pinch gestures via @use-gesture/react.
 *
 *  - Plain wheel → smoothed pan
 *  - Ctrl/Cmd + wheel → smoothed zoom (Magic Mouse, regular mouse, and
 *    Chrome's trackpad-pinch which is emulated as ctrl+wheel)
 *  - Native trackpad pinch on Safari → smoothed zoom via onPinch
 *
 *  The hook drives the *Smooth variants — each input event nudges a target
 *  and a rAF loop in `useCanvas` interpolates the visible transform toward
 *  it. This evens out variable wheel rates and gives 120Hz displays
 *  per-frame motion between input events. */
export function useWheelNavigation(
  containerRef: React.RefObject<HTMLDivElement | null>,
  canvasLocked: boolean,
  windowW: number,
  windowH: number,
  panSmooth: (dx: number, dy: number) => void,
  zoomBySmooth: (factor: number, cx: number, cy: number, windowW: number, windowH: number) => void,
) {
  useGesture(
    {
      onWheel: ({ event, ctrlKey, delta: [dx, dy] }) => {
        // Stop horizontal trackpad/Magic Mouse swipes from triggering the
        // browser's back/forward navigation (and stop default scroll).
        event.preventDefault();
        if (canvasLocked) return;
        if (ctrlKey || event.metaKey) {
          // Clamp avoids massive single-step zoom from Chrome's trackpad-pinch
          // emulation, which can fire WheelEvents with deltaY up to ~100.
          const maxDy = 10;
          const clampedDy = Math.max(-maxDy, Math.min(maxDy, dy));
          const factor = Math.pow(ZOOM_SENSITIVITY, clampedDy);
          zoomBySmooth(factor, event.clientX, event.clientY, windowW, windowH);
          return;
        }
        panSmooth(-dx * PAN_MULTIPLIER, -dy * PAN_MULTIPLIER);
      },
      onPinch: ({ origin: [ox, oy], offset: [scale], first, memo, event }) => {
        if (canvasLocked) return;
        // Skip wheel-driven pinch — already handled in onWheel for parity
        // with Magic Mouse + ctrl/cmd+scroll. Only let true GestureEvents
        // (Safari trackpad) drive the multiplicative pinch path.
        if (event.type === "wheel") return memo;
        if (first) return scale;
        const prev = (memo as number | undefined) ?? scale;
        if (prev > 0 && scale !== prev) {
          zoomBySmooth(scale / prev, ox, oy, windowW, windowH);
        }
        return scale;
      },
    },
    {
      target: containerRef,
      eventOptions: { passive: false },
      pinch: { scaleBounds: { min: 0, max: Infinity }, rubberband: false },
    },
  );
}
