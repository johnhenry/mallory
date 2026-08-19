/**
 * Pixel geometry for rendering tri-tile-model.ts's grid on a canvas -- a
 * TRUE edge-to-edge triangular mesh, matching mallory-math's `triOrientation`/
 * `triNeighbor` combinatorial adjacency exactly (verified below, and in this
 * module's own test file): an "up" cell's `left`/`right`/`top` neighbors
 * (`(x-1,y)`/`(x+1,y)`/`(x,y+1)`) share a REAL pixel edge with it, not just a
 * bounding box.
 *
 * Construction: row `y` occupies the vertical band `[y*cellHeight,
 * (y+1)*cellHeight]`. Within a row, column `x`'s triangle is centered at
 * `centerX = x*halfWidth + halfWidth` (`halfWidth = cellWidth / 2`), with its
 * BASE (full `cellWidth` wide) on one side of the row and its apex a single
 * point on the other -- "up" cells have their base at the row's bottom edge
 * and apex at the top; "down" cells the reverse. Consecutive columns
 * alternate orientation (`triOrientation`'s `(x+y)%2`), and each one's base
 * half-overlaps the previous column's, so:
 *
 * - `right` neighbor `(x+1,y)`: `up(x,y)`'s right edge (base-right-corner to
 *   apex) is the exact same segment as `down(x+1,y)`'s left edge (apex to
 *   base-left-corner) -- both run between `(centerX(x)+halfWidth, base_y)`
 *   and `(centerX(x+1)-halfWidth, apex_y)`, and `centerX(x)+halfWidth ===
 *   centerX(x+1)-halfWidth` by construction.
 * - `top`/`bottom` neighbor `(x,y+1)`: `up(x,y)`'s base (row `y`'s bottom
 *   edge) and `down(x,y+1)`'s base (row `y+1`'s top edge, i.e. the SAME
 *   pixel row boundary) are the identical segment, since both are centered
 *   on the same `centerX(x)`.
 *
 * Every internal edge is drawn by exactly one straight line shared by both
 * triangles either side of it -- no gaps, no near-miss double-strokes.
 */
import type { TriDirection, TriOrientation } from "mallory-math";

export interface Point {
  x: number;
  y: number;
}

/**
 * The pixel x-coordinate of column `x`'s triangle center, given a base
 * width of `cellWidth` (so each column advances by `cellWidth / 2`, half a
 * base-width, per this module's own doc comment). Exported so callers can
 * compute a canvas's bounding width without duplicating the formula (see
 * `triCanvasWidth` in `TilesPanel.tsx`).
 */
export function triCenterX(x: number, cellWidth: number): number {
  const halfWidth = cellWidth / 2;
  return x * halfWidth + halfWidth;
}

/** The 3 corner points of cell `(x, y)`'s triangle, apex up or down per `orientation`, true edge-to-edge with its `left`/`right`/`top`/`bottom` neighbors -- see this module's own doc comment for the construction. */
export function triCorners(x: number, y: number, cellWidth: number, cellHeight: number, orientation: TriOrientation): Point[] {
  const halfWidth = cellWidth / 2;
  const centerX = triCenterX(x, cellWidth);
  const left = centerX - halfWidth;
  const right = centerX + halfWidth;
  const top = y * cellHeight;
  const bottom = (y + 1) * cellHeight;
  return orientation === "up"
    ? [
        { x: left, y: bottom },
        { x: right, y: bottom },
        { x: centerX, y: top },
      ]
    : [
        { x: left, y: top },
        { x: right, y: top },
        { x: centerX, y: bottom },
      ];
}

/**
 * The 2 endpoint pixels of `TriDirection` `d`'s edge, given `corners` (as
 * returned by `triCorners`) -- same index pattern for BOTH orientations
 * (`corners[0]` is the base corner nearer `x-1`, `corners[1]` nearer
 * `x+1`, `corners[2]` the apex, per `triCorners`'s own construction):
 * `"left"` is `[corners[0], corners[2]]`, `"right"` is `[corners[1],
 * corners[2]]`, and the base direction (`"top"` on an "up" cell, `"bottom"`
 * on a "down" cell -- whichever `d` is passed, since a tile only has one
 * or the other) is `[corners[0], corners[1]]`.
 */
export function triEdgeSegment(corners: readonly Point[], direction: TriDirection): [Point, Point] {
  if (direction === "left") return [corners[0]!, corners[2]!];
  if (direction === "right") return [corners[1]!, corners[2]!];
  return [corners[0]!, corners[1]!];
}
