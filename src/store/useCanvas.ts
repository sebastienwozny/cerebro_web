import { useCallback, useRef, useState, startTransition } from "react";
import { MIN_SCALE, MAX_SCALE, ZOOM_SENSITIVITY, CANVAS_SMOOTH_TAU_MS } from "../constants";

export interface CanvasTransform {
  offsetX: number;
  offsetY: number;
  scale: number;
}

const STORAGE_KEY = "cerebro.canvas";

function loadSaved(): CanvasTransform {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // corrupted storage — fall through to defaults
  }
  return { offsetX: 0, offsetY: 0, scale: 0.5 };
}

export function useCanvas() {
  const transformRef = useRef<CanvasTransform>(loadSaved());
  // Smoothed pan/zoom: input handlers update `targetRef`, an rAF loop
  // interpolates `transformRef.current` toward it via exponential decay.
  // Time-based factor so the feel matches across 60Hz and 120Hz displays.
  const targetRef = useRef<CanvasTransform>({ ...transformRef.current });
  const layerRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [transformVersion, setTransformVersion] = useState(0);
  const scheduleSave = useCallback(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(transformRef.current));
    }, 300);
  }, []);

  const rafRef = useRef(0);
  const scheduleRerender = useCallback(() => {
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        // Mark the pan/zoom-driven re-render as a transition so React 18
        // can interrupt it for higher-priority work (text input, hover,
        // selection updates). Keeps urgent UI snappy under heavy load.
        startTransition(() => setTransformVersion(v => v + 1));
      });
    }
  }, []);

  const applyTransform = useCallback(() => {
    const el = layerRef.current;
    if (!el) return;
    const { offsetX, offsetY, scale } = transformRef.current;
    // Expose pan/zoom as CSS vars instead of applying a transform on the
    // canvas layer itself. A `transform` on the parent would create a
    // stacking context that traps every descendant's z-index — preventing
    // dragged cards from lifting above e.g. video PVPs. By keeping the
    // canvas layer transform-free, cards and PVPs share the body stacking
    // context and their `note.zOrder` z-indices compete naturally. Each
    // card composes these CSS vars into its own transform to apply
    // pan/zoom to its position.
    //
    // Round at write-time only: the in-memory offset stays float so
    // sub-pixel wheel deltas (Magic Mouse momentum sends ~0.4px/event)
    // accumulate properly. Rounding per-event would lose those fractions
    // and produce a visible "shake" at low velocities.
    el.style.setProperty("--pan-x", `${Math.round(offsetX)}px`);
    el.style.setProperty("--pan-y", `${Math.round(offsetY)}px`);
    el.style.setProperty("--zoom", `${scale}`);
    scheduleRerender();
  }, [scheduleRerender]);

  // Quantize zoom to 0.001 increments — fine enough to feel smooth, coarse
  // enough to keep the composed transform from landing on different
  // sub-pixel boundaries every frame (which would make rounded card edges
  // shimmer under anti-aliasing).
  const SCALE_SNAP = 0.001;
  const snapScale = (s: number) => Math.round(s / SCALE_SNAP) * SCALE_SNAP;

  // ── Smoothing animation loop ────────────────────────────────────────────
  // Drives `transformRef.current` toward `targetRef.current` via exponential
  // decay (factor = 1 - exp(-dt / TAU)). The decay is reframerate-independent:
  // a 120Hz display gets 2× as many ticks per second but each tick advances
  // half as far, so total convergence time is the same — just smoother on
  // ProMotion. Stops when the gap is below an epsilon.
  const animFrameRef = useRef(0);
  const lastTickRef = useRef(0);
  const ANIM_EPSILON_PX = 0.05;
  const ANIM_EPSILON_SCALE = 0.0001;

  const tick = useCallback((now: number) => {
    animFrameRef.current = 0;
    const t = transformRef.current;
    const tg = targetRef.current;
    const dt = lastTickRef.current ? Math.min(50, now - lastTickRef.current) : 16;
    lastTickRef.current = now;
    const factor = 1 - Math.exp(-dt / CANVAS_SMOOTH_TAU_MS);

    const dx = tg.offsetX - t.offsetX;
    const dy = tg.offsetY - t.offsetY;
    const ds = tg.scale - t.scale;

    if (
      Math.abs(dx) < ANIM_EPSILON_PX &&
      Math.abs(dy) < ANIM_EPSILON_PX &&
      Math.abs(ds) < ANIM_EPSILON_SCALE
    ) {
      // Snap to target and stop the loop.
      t.offsetX = tg.offsetX;
      t.offsetY = tg.offsetY;
      t.scale = tg.scale;
      lastTickRef.current = 0;
      applyTransform();
      return;
    }

    t.offsetX += dx * factor;
    t.offsetY += dy * factor;
    t.scale += ds * factor;
    applyTransform();
    animFrameRef.current = requestAnimationFrame(tick);
  }, [applyTransform]);

  const startAnimating = useCallback(() => {
    if (!animFrameRef.current) {
      lastTickRef.current = 0;
      animFrameRef.current = requestAnimationFrame(tick);
    }
  }, [tick]);

  // ── Instant API: jumps both current and target ──────────────────────────
  // For direct manipulation (space-drag, programmatic centering) where
  // smoothing would feel like lag.
  const pan = useCallback(
    (dx: number, dy: number) => {
      const t = transformRef.current;
      const tg = targetRef.current;
      t.offsetX += dx;
      t.offsetY += dy;
      tg.offsetX = t.offsetX;
      tg.offsetY = t.offsetY;
      applyTransform();
      scheduleSave();
    },
    [applyTransform, scheduleSave]
  );

  const zoomBy = useCallback(
    (factor: number, cx: number, cy: number, windowW: number, windowH: number) => {
      const t = transformRef.current;
      const tg = targetRef.current;
      const newScale = snapScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, t.scale * factor)));
      const cursorFromCenterX = cx - windowW / 2;
      const cursorFromCenterY = cy - windowH / 2;
      const ratio = newScale / t.scale;
      t.offsetX = cursorFromCenterX - ratio * (cursorFromCenterX - t.offsetX);
      t.offsetY = cursorFromCenterY - ratio * (cursorFromCenterY - t.offsetY);
      t.scale = newScale;
      tg.offsetX = t.offsetX;
      tg.offsetY = t.offsetY;
      tg.scale = t.scale;
      applyTransform();
      scheduleSave();
    },
    [applyTransform, scheduleSave]
  );

  // ── Smoothed API: pushes the target only, animation loop catches up ─────
  // For wheel/pinch input where event rates are uneven and ProMotion
  // displays benefit from interpolation between events.
  const panSmooth = useCallback(
    (dx: number, dy: number) => {
      targetRef.current.offsetX += dx;
      targetRef.current.offsetY += dy;
      startAnimating();
      scheduleSave();
    },
    [startAnimating, scheduleSave]
  );

  const zoomBySmooth = useCallback(
    (factor: number, cx: number, cy: number, windowW: number, windowH: number) => {
      // Anchor zoom around the cursor in TARGET space (not current) so
      // back-to-back pinch events compose consistently — otherwise each
      // event would pull the target back toward the in-flight current.
      const tg = targetRef.current;
      const newScale = snapScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, tg.scale * factor)));
      const cursorFromCenterX = cx - windowW / 2;
      const cursorFromCenterY = cy - windowH / 2;
      const ratio = newScale / tg.scale;
      tg.offsetX = cursorFromCenterX - ratio * (cursorFromCenterX - tg.offsetX);
      tg.offsetY = cursorFromCenterY - ratio * (cursorFromCenterY - tg.offsetY);
      tg.scale = newScale;
      startAnimating();
      scheduleSave();
    },
    [startAnimating, scheduleSave]
  );

  const zoom = useCallback(
    (delta: number, cx: number, cy: number, windowW: number, windowH: number) => {
      zoomBy(Math.pow(ZOOM_SENSITIVITY, delta), cx, cy, windowW, windowH);
    },
    [zoomBy]
  );

  const getTransform = useCallback(() => transformRef.current, []);

  return {
    transformRef,
    transformVersion,
    layerRef,
    pan,
    panSmooth,
    zoom,
    zoomBy,
    zoomBySmooth,
    getTransform,
    applyTransform,
  };
}
