import type { Viewport } from "./viewport.ts";

/**
 * Shared pan/zoom/pinch math (issue #53's remaining scope: "each [panel]
 * needs the base wheel-zoom/drag-pan machinery built before pinch can sit
 * on top of it"). Extracted from `GraphCanvasMulti.tsx`'s existing inline
 * wheel/pointer handlers -- the formulas here are unchanged from that
 * component's own working, live-browser-verified gesture code (see #106),
 * just factored out into pure, independently testable functions so every
 * OTHER panel that adds pan/zoom (GraphCanvas, ComplexPanel, ...) can
 * reuse the exact same math instead of re-deriving or copy-pasting it, and
 * so the math itself has real unit coverage for the first time -- inline
 * in event handlers, it had none.
 *
 * All three functions are pure and DOM-free: no pointer events, no
 * `CellGraph`, no React. Callers own the event wiring (pointer capture,
 * the live/committed viewport-cell split, multi-touch tracking) and pass
 * in already-extracted screen coordinates and spans.
 */

/**
 * Recomputes a viewport so the data point (`anchorX`, `anchorY`) stays
 * under screen point (`sx`, `sy`), for a viewport of the given data-space
 * span -- the one formula panning, wheel-zoom, and pinch-zoom all reduce
 * to: panning holds the span fixed and moves the anchor's screen position;
 * zooming holds the anchor's screen position fixed and changes the span.
 */
export function viewportFromAnchor(anchorX: number, anchorY: number, sx: number, sy: number, spanX: number, spanY: number, width: number, height: number): Viewport {
  const xMin = anchorX - (sx / width) * spanX;
  const yMin = anchorY - ((height - sy) / height) * spanY;
  return { xMin, xMax: xMin + spanX, yMin, yMax: yMin + spanY };
}

/**
 * Wheel-to-zoom step factor: `deltaY > 0` (scrolling down/away) zooms OUT
 * (factor > 1, span grows) and `deltaY <= 0` zooms IN (factor < 1, span
 * shrinks) -- the scroll-to-zoom convention every panel in this app uses.
 * Multiply a viewport's span by this factor, then re-anchor with
 * `viewportFromAnchor` at the cursor's data point.
 */
export function wheelZoomFactor(deltaY: number, step = 1.1): number {
  return deltaY > 0 ? step : 1 / step;
}

/**
 * Pinch-to-zoom span factor from a gesture's starting two-finger distance
 * and the current one: fingers moving apart (`currentDistancePx` grows
 * past `startDistancePx`) zooms IN (factor < 1, span shrinks), matching
 * the pinch-out-to-zoom-in convention every touch UI uses. Multiply a
 * viewport's span (captured at gesture start) by this factor, then
 * re-anchor with `viewportFromAnchor` at the pinch's midpoint.
 */
export function pinchZoomFactor(startDistancePx: number, currentDistancePx: number): number {
  return startDistancePx / currentDistancePx;
}
