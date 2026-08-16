/**
 * Interactive node/edge editor (issue #24's remaining scope, item 1):
 * click-to-add-vertex, drag-between-vertices-for-a-weighted-edge, as an
 * alternative/complement to the text edge-list input. This module holds
 * the pure, hand-testable pieces of that interaction -- vertex-label
 * generation, layout merging, and hit-testing -- kept separate from
 * GraphTheoryPanel.tsx's pointer-event wiring, mirroring the split every
 * other panel's editor logic uses (e.g. image-frequency.ts's
 * paintMaskCell/canvasPointToGridCell next to ImageFrequencyPanel.tsx's
 * pointer handlers).
 */
import { circularLayout, type LayoutPoint } from "./graph-ops.ts";

/**
 * circularLayout, with any editor-placed positions overriding their
 * vertex's fallback slot. `showEditor=false` returns exactly
 * circularLayout's own result -- unaffected for anyone who never touches
 * the editor (the panel's original rendering behavior, preserved bit-for-
 * bit).
 */
export function computeLayout(vertices: readonly string[], vertexPositions: Readonly<Record<string, LayoutPoint>>, showEditor: boolean): Map<string, LayoutPoint> {
  const layout = circularLayout(vertices);
  if (!showEditor) return layout;
  for (const v of vertices) {
    const pos = vertexPositions[v];
    if (pos) layout.set(v, pos);
  }
  return layout;
}

/**
 * Spreadsheet-column-style vertex label: A, B, ..., Z, AA, AB, ..., skipping
 * any label already present in `existingLabels` -- so a graph built partly
 * via the text box (which can use ANY label, not just this scheme) never
 * collides with an editor-generated one. Picks the lowest such label, not
 * just "one more than the last editor-added vertex", so deleting/renaming
 * vertices via the text box doesn't leave permanent gaps this generator
 * refuses to reuse.
 */
export function nextVertexLabel(existingLabels: readonly string[]): string {
  const used = new Set(existingLabels);
  let n = 0;
  while (used.has(columnLabel(n))) n++;
  return columnLabel(n);
}

function columnLabel(n: number): string {
  let label = "";
  let x = n;
  do {
    label = String.fromCharCode(65 + (x % 26)) + label;
    x = Math.floor(x / 26) - 1;
  } while (x >= 0);
  return label;
}

export interface ScreenPoint {
  sx: number;
  sy: number;
}

/**
 * The nearest vertex within `hitRadiusPx` screen pixels of `point`, or null
 * if none qualifies -- pure screen-space distance, so it needs no Viewport/
 * canvas machinery to test directly. Ties (equidistant vertices) resolve to
 * whichever is checked first in `positions`' own iteration order; expected
 * to never matter in practice since real vertices don't overlap.
 */
export function findVertexAt(point: ScreenPoint, positions: ReadonlyMap<string, ScreenPoint>, hitRadiusPx: number): string | null {
  let closest: string | null = null;
  let closestDist = Infinity;
  for (const [label, pos] of positions) {
    const dist = Math.hypot(pos.sx - point.sx, pos.sy - point.sy);
    if (dist <= hitRadiusPx && dist < closestDist) {
      closest = label;
      closestDist = dist;
    }
  }
  return closest;
}
