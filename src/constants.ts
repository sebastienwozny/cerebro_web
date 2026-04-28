// Card dimensions (matching Swift constants)
// Card frame at canvas-rest. Content area (CARD_CONTENT_W) is centered
// inside with 100px margin per side. Aspect ratio ≈ √2 (A4 portrait).
export const CARD_W = 840;
export const CARD_H = 1188;
export const CARD_CONTENT_W = 640;
export const CARD_RADIUS = 100;

// Open/close animation durations (seconds)
export const OPEN_DURATION = 0.6;
export const CLOSE_DURATION = 0.6;

// Delete animation duration (seconds) — matches CSS transition in NoteCard
export const DELETE_DURATION = 0.4;

// Grid reorder
export const GRID_GAP = 100;

// Canvas zoom bounds
export const MIN_SCALE = 0.1;
export const MAX_SCALE = 3;

// Canvas interaction tuning
export const ZOOM_SENSITIVITY = 0.995;
export const PAN_MULTIPLIER = 1.0;
// Time constant (ms) for canvas pan/zoom smoothing toward the input target.
// Smaller = snappier (less inertia); larger = more "trailing" feel.
// 60–80ms is the sweet spot for "fluid but responsive". Display-rate
// independent (interpolation uses dt-based exponential decay).
export const CANVAS_SMOOTH_TAU_MS = 30;
export const DRAG_LERP_FACTOR = 0.35;
