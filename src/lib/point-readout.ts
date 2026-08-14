import type { Path2D } from "mallory-math";
import { toScreenX, toScreenY, type Viewport } from "./viewport.ts";

export interface ReadoutCandidate {
  rowId: string;
  path: Path2D;
  color: number;
}

export interface PointReadout {
  rowId: string;
  x: number;
  y: number;
  color: number;
}

/**
 * Finds the sampled curve point (across every candidate row's already-
 * sampled Path2D) nearest a click, measured in SCREEN space rather than
 * data space -- a data-space nearest search would be skewed whenever the
 * viewport's x and y spans differ, since "close" wouldn't match visual
 * intuition. Only considers actual sample points (each Path2D command's
 * x/y), not points interpolated between two consecutive samples, matching
 * every other row-derived "condition" cell in GraphCanvasMulti (roots,
 * discontinuities) which are similarly derived straight from the sampled
 * path rather than a fresh evaluate.
 *
 * Returns null if nothing sampled is within `maxScreenDistance` pixels --
 * a click far from any curve shouldn't silently snap to the globally
 * nearest (possibly off-screen) sample point.
 */
export function findNearestPointOnRows(
  candidates: readonly ReadoutCandidate[],
  clickScreenX: number,
  clickScreenY: number,
  viewport: Viewport,
  width: number,
  height: number,
  maxScreenDistance = 20,
): PointReadout | null {
  let best: PointReadout | null = null;
  let bestDistSq = maxScreenDistance * maxScreenDistance;
  for (const { rowId, path, color } of candidates) {
    for (const cmd of path.commands) {
      const sx = toScreenX(cmd.x, viewport, width);
      const sy = toScreenY(cmd.y, viewport, height);
      const dx = sx - clickScreenX;
      const dy = sy - clickScreenY;
      const distSq = dx * dx + dy * dy;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = { rowId, x: cmd.x, y: cmd.y, color };
      }
    }
  }
  return best;
}
