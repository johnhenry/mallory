/**
 * Pixel geometry for rendering tri-tile-model.ts's grid on a canvas.
 *
 * Deliberately a SIMPLIFIED bounding-box layout, not a mathematically
 * exact edge-to-edge equilateral triangular mesh: each cell `(x, y)`
 * occupies its own independent `cellWidth x cellHeight` rectangle (exactly
 * like the square lattice's own `CELL_SIZE` grid), and within that box
 * draws an upward- or downward-pointing triangle inscribed in it (apex at
 * top-center for an "up" cell, apex at bottom-center for "down"), per
 * {@link triOrientation}. Adjacent cells' triangles do NOT literally share
 * a physical edge the way a true equilateral tiling would -- getting that
 * exactly right (deriving pixel-perfect vertex-sharing formulas for a
 * sheared/offset triangular strip mesh) needs live-browser iteration to
 * verify with confidence, which wasn't available while building this.
 * This still renders every cell in its correct grid position with the
 * correct up/down shape and correct tile-id coloring/labeling -- the
 * actual point of the view (which tile is where) -- just without visually
 * touching edges. A closer-to-exact mesh is a reasonable follow-up once
 * live verification is available.
 */
import type { TriOrientation } from "mallory-math";

export interface Point {
  x: number;
  y: number;
}

/** The 3 corner points of the inscribed triangle for cell `(x, y)`'s `cellWidth x cellHeight` bounding box, apex up or down per `orientation`. */
export function triCorners(x: number, y: number, cellWidth: number, cellHeight: number, orientation: TriOrientation): Point[] {
  const left = x * cellWidth;
  const right = (x + 1) * cellWidth;
  const top = y * cellHeight;
  const bottom = (y + 1) * cellHeight;
  const midX = (left + right) / 2;
  return orientation === "up"
    ? [
        { x: left, y: bottom },
        { x: right, y: bottom },
        { x: midX, y: top },
      ]
    : [
        { x: left, y: top },
        { x: right, y: top },
        { x: midX, y: bottom },
      ];
}
