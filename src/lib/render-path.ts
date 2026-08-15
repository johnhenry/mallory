import type { Path2D as MalloryPath } from "mallory-math";
import type { ImplicitSegment } from "./sample-implicit.ts";
import { toScreenX, toScreenY, type Viewport } from "./viewport.ts";

export type { Viewport } from "./viewport.ts";

/**
 * Draw a marching-squares implicit-curve trace: disconnected line segments,
 * not a single polyline (an implicit relation can have multiple components
 * or branches), so each segment gets its own `moveTo`/`lineTo` pair rather
 * than being concatenated into one path.
 */
export function drawImplicitCurve(
  ctx: CanvasRenderingContext2D,
  segments: ImplicitSegment[],
  viewport: Viewport,
  width: number,
  height: number,
  color = "#2563eb",
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const s of segments) {
    ctx.moveTo(toScreenX(s.x1, viewport, width), toScreenY(s.y1, viewport, height));
    ctx.lineTo(toScreenX(s.x2, viewport, width), toScreenY(s.y2, viewport, height));
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw a mallory-math Path2D (moveTo/lineTo commands in data space) onto a
 * real Canvas2D context. `dashed` (e.g. for a derivative overlay sharing
 * its parent curve's color) is the one thing not already carried by the
 * Path2D's own `stroke` style, since that comes from upstream
 * `GraphUtils.vectorToCurve` and has no dash concept.
 */
export function drawPath(
  ctx: CanvasRenderingContext2D,
  path: MalloryPath,
  viewport: Viewport,
  width: number,
  height: number,
  dashed = false,
): void {
  ctx.save();
  ctx.strokeStyle = `#${path.stroke.color.toString(16).padStart(6, "0")}`;
  ctx.globalAlpha = path.stroke.alpha;
  ctx.lineWidth = path.stroke.thickness || 1;
  if (dashed) ctx.setLineDash([6, 4]);
  ctx.beginPath();
  for (const cmd of path.commands) {
    const sx = toScreenX(cmd.x, viewport, width);
    const sy = toScreenY(cmd.y, viewport, height);
    if (cmd.op === "moveTo") ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw one row of a shared multi-expression canvas (GraphCanvasMulti.tsx) --
 * a thin wrapper around `drawPath` that's a no-op when the row is toggled
 * hidden, so the draw loop can call this unconditionally for every row in
 * `EXPRESSION_LIST_CELL` order without an `if (visible)` at every call site.
 * v1 draws just the curve itself; region-shading/area-fill/point-handle
 * layers stay single-expression-only for now (see `cellIdsMultiRow`'s doc
 * comment).
 */
export function drawExpressionLayer(
  ctx: CanvasRenderingContext2D,
  path: MalloryPath,
  visible: boolean,
  viewport: Viewport,
  width: number,
  height: number,
): void {
  if (!visible) return;
  drawPath(ctx, path, viewport, width, height);
}

/** Draw a filled circular handle at a data-space point (used for draggable points). */
export function drawPoint(
  ctx: CanvasRenderingContext2D,
  point: { x: number; y: number },
  viewport: Viewport,
  width: number,
  height: number,
  radius = 6,
  color = "#dc2626",
): void {
  const sx = toScreenX(point.x, viewport, width);
  const sy = toScreenY(point.y, viewport, height);
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(sx, sy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Draw a translucent vertical-strip fill over every `true` entry of a
 * region mask (one boolean per sample point across a viewport-width grid,
 * same resolution as the curve it's shading). A grid-based fill, not an
 * exact boundary-curve computation, matching the mask's own sampling
 * resolution.
 */
export function drawRegionMask(
  ctx: CanvasRenderingContext2D,
  mask: boolean[],
  viewport: Viewport,
  width: number,
  height: number,
  color = "rgba(37, 99, 235, 0.15)",
): void {
  if (mask.length === 0) return;
  const stripWidth = width / mask.length;
  ctx.save();
  ctx.fillStyle = color;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const x = viewport.xMin + (i / Math.max(1, mask.length - 1)) * (viewport.xMax - viewport.xMin);
    const sx = toScreenX(x, viewport, width);
    ctx.fillRect(sx - stripWidth / 2, 0, stripWidth, height);
  }
  ctx.restore();
}

/**
 * Converts a `0xRRGGBB` numeric color (this app's convention for a curve's
 * own color, e.g. `ExpressionRow`'s `ids.color`) to a translucent CSS
 * `rgba(...)` string -- issue #51's per-row area-under-curve shading:
 * `drawFilledArea` fills in each row's OWN color rather than one fixed
 * blue, so two overlapping shaded regions stay visually distinguishable
 * instead of blending into an indistinguishable double-blue wash.
 */
export function hexToRgba(hex: number, alpha: number): string {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Draw the area between a (possibly gap-broken) curve and y=0, one closed
 * fill polygon per contiguous run -- each `moveTo`-delimited segment from
 * `sampleExpr`'s gap-tolerant sampling gets its own polygon, so a
 * discontinuous integrand shades disjoint regions correctly instead of one
 * polygon spanning the gap.
 */
export function drawFilledArea(
  ctx: CanvasRenderingContext2D,
  path: MalloryPath,
  viewport: Viewport,
  width: number,
  height: number,
  color = "rgba(37, 99, 235, 0.25)",
): void {
  const zeroSy = toScreenY(0, viewport, height);
  ctx.save();
  ctx.fillStyle = color;
  let i = 0;
  while (i < path.commands.length) {
    const runStart = i;
    i++;
    while (i < path.commands.length && path.commands[i]?.op === "lineTo") i++;
    const run = path.commands.slice(runStart, i);
    if (run.length === 0) continue;
    const first = run[0];
    const last = run[run.length - 1];
    if (!first || !last) continue;
    ctx.beginPath();
    ctx.moveTo(toScreenX(first.x, viewport, width), zeroSy);
    for (const cmd of run) ctx.lineTo(toScreenX(cmd.x, viewport, width), toScreenY(cmd.y, viewport, height));
    ctx.lineTo(toScreenX(last.x, viewport, width), zeroSy);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Draw a grid of short line segments, each centered at (x,y) and oriented at
 * the local slope dy/dx = f(x,y) -- a fixed pixel half-length regardless of
 * the slope's magnitude (direction carries the information here, not
 * length), so a near-vertical slope doesn't visually dominate a near-zero
 * one.
 */
export function drawSlopeField(
  ctx: CanvasRenderingContext2D,
  points: Array<{ x: number; y: number; slope: number }>,
  viewport: Viewport,
  width: number,
  height: number,
  halfLengthPx = 8,
  color = "rgba(37, 99, 235, 0.5)",
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  for (const { x, y, slope } of points) {
    const sx = toScreenX(x, viewport, width);
    const sy = toScreenY(y, viewport, height);
    // Screen-space y is flipped vs. data-space y, so a positive dy/dx must
    // tilt up-and-to-the-right on screen -- i.e. toward *decreasing* sy.
    const angle = Math.atan2(-slope, 1);
    const dx = Math.cos(angle) * halfLengthPx;
    const dy = Math.sin(angle) * halfLengthPx;
    ctx.beginPath();
    ctx.moveTo(sx - dx, sy - dy);
    ctx.lineTo(sx + dx, sy + dy);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Draw a grid of direction arrows for a 2D vector field (dx, dy) at each
 * (x, y) -- the phase-portrait analogue of `drawSlopeField`. Unlike a slope
 * field's undirected segments, a coupled system's flow has a genuine
 * forward direction, so each arrow gets a small arrowhead. Normalized to a
 * fixed pixel length regardless of magnitude (direction carries the
 * information here, not speed), matching `drawSlopeField`'s convention.
 */
export function drawVectorField(
  ctx: CanvasRenderingContext2D,
  points: Array<{ x: number; y: number; dx: number; dy: number }>,
  viewport: Viewport,
  width: number,
  height: number,
  halfLengthPx = 8,
  color = "rgba(37, 99, 235, 0.55)",
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5;
  for (const { x, y, dx, dy } of points) {
    const mag = Math.hypot(dx, dy);
    if (mag < 1e-12) continue;
    const sx = toScreenX(x, viewport, width);
    const sy = toScreenY(y, viewport, height);
    // Screen-space y is flipped vs. data-space y.
    const ux = dx / mag;
    const uy = -dy / mag;
    const tipX = sx + ux * halfLengthPx;
    const tipY = sy + uy * halfLengthPx;
    const tailX = sx - ux * halfLengthPx;
    const tailY = sy - uy * halfLengthPx;
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();
    const arrowAngle = Math.atan2(tipY - tailY, tipX - tailX);
    const headLen = halfLengthPx * 0.6;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - headLen * Math.cos(arrowAngle - Math.PI / 6), tipY - headLen * Math.sin(arrowAngle - Math.PI / 6));
    ctx.lineTo(tipX - headLen * Math.cos(arrowAngle + Math.PI / 6), tipY - headLen * Math.sin(arrowAngle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** Draw a set of discrete data-space points as a scatter (used for finite-structure plots, e.g. GF(7)). */
export function drawScatter(
  ctx: CanvasRenderingContext2D,
  points: Array<{ x: number; y: number }>,
  viewport: Viewport,
  width: number,
  height: number,
  radius = 5,
  color = "#2563eb",
): void {
  ctx.save();
  ctx.fillStyle = color;
  for (const p of points) {
    const sx = toScreenX(p.x, viewport, width);
    const sy = toScreenY(p.y, viewport, height);
    ctx.beginPath();
    ctx.arc(sx, sy, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Draw a set of discrete data-space points as unfilled (stroked-only) circles -- used for discontinuity/domain-boundary markers, visually distinct from `drawScatter`'s solid dots. */
export function drawOpenCircles(
  ctx: CanvasRenderingContext2D,
  points: Array<{ x: number; y: number }>,
  viewport: Viewport,
  width: number,
  height: number,
  radius = 5,
  color = "#d97706",
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  for (const p of points) {
    const sx = toScreenX(p.x, viewport, width);
    const sy = toScreenY(p.y, viewport, height);
    ctx.beginPath();
    ctx.arc(sx, sy, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Draw a simple connect-the-dots line through an ordered array of
 * data-space points -- the plain-array counterpart to `drawPath`'s
 * mallory-math `Path2D` commands, for callers (e.g. a sampled waveform or
 * FFT spectrum) that already have flat `{x,y}` arrays and have no need for
 * `Path2D`'s discontinuity-aware `moveTo` segments.
 */
export function drawPolyline(
  ctx: CanvasRenderingContext2D,
  points: ReadonlyArray<{ x: number; y: number }>,
  viewport: Viewport,
  width: number,
  height: number,
  color = "#2563eb",
): void {
  if (points.length === 0) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  points.forEach((p, i) => {
    const sx = toScreenX(p.x, viewport, width);
    const sy = toScreenY(p.y, viewport, height);
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  });
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw a set of `{x0, x1, count}` bins as adjacent filled rectangles from
 * the viewport's y=0 baseline up to each bin's count -- a plain frequency
 * histogram, one bar per bin, in data-space x but count-space y (the
 * viewport's `yMin`/`yMax` are expected to already span `[0, maxCount]` or
 * similar; this function does no y-scaling of its own beyond what
 * `toScreenY` does for any other data-space y value).
 */
export function drawHistogram(
  ctx: CanvasRenderingContext2D,
  bins: ReadonlyArray<{ x0: number; x1: number; count: number }>,
  viewport: Viewport,
  width: number,
  height: number,
  color = "#93c5fd",
  strokeColor = "#2563eb",
): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1;
  const zeroY = toScreenY(0, viewport, height);
  for (const bin of bins) {
    const sx0 = toScreenX(bin.x0, viewport, width);
    const sx1 = toScreenX(bin.x1, viewport, width);
    const sy = toScreenY(bin.count, viewport, height);
    ctx.fillRect(sx0, sy, sx1 - sx0, zeroY - sy);
    ctx.strokeRect(sx0, sy, sx1 - sx0, zeroY - sy);
  }
  ctx.restore();
}
