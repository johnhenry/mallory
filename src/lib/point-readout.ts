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

/**
 * Issue #50's keyboard-nav half: moves a readout one sampled point left/
 * right along a single row's already-sampled path -- the arrow-key
 * counterpart to `findNearestPointOnRows`'s pointer-driven nearest-click
 * search. `currentX` is `null` the first time (no readout yet, e.g. panel
 * just gained focus): direction 1 starts at the first sample, -1 at the
 * last, rather than requiring an initial click first. With a readout
 * already at `currentX`, moves to the immediate next/previous sample by
 * index -- not a fresh nearest-x search, so repeatedly pressing the same
 * arrow key always advances even across duplicate/near-duplicate x
 * values a curvature-adaptive sampler can produce.
 */
export function stepReadoutAlongPath(rowId: string, path: Path2D, color: number, currentX: number | null, direction: 1 | -1): PointReadout | null {
  const commands = path.commands;
  if (commands.length === 0) return null;
  if (currentX === null) {
    const cmd = direction === 1 ? commands[0] : commands[commands.length - 1];
    return cmd ? { rowId, x: cmd.x, y: cmd.y, color } : null;
  }
  let nearestIndex = 0;
  let nearestDist = Infinity;
  for (let i = 0; i < commands.length; i++) {
    const dist = Math.abs((commands[i] as { x: number }).x - currentX);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearestIndex = i;
    }
  }
  const nextIndex = Math.min(commands.length - 1, Math.max(0, nearestIndex + direction));
  const next = commands[nextIndex] as { x: number; y: number };
  return { rowId, x: next.x, y: next.y, color };
}
