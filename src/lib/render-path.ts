import type { Path2D as MalloryPath } from "@johnhenry/math";
import type { ImplicitBox } from "./interval-implicit.ts";
import type { ImplicitSegment } from "./sample-implicit.ts";
import { getThemeColors } from "./theme-colors.ts";
import { toScreenX, toScreenY, type Viewport } from "./viewport.ts";

export type { Viewport } from "./viewport.ts";

/**
 * Nice round tick values spanning [min, max], D3-style "nice numbers":
 * pick a step from {1, 2, 5} x 10^k closest to (range / targetCount), then
 * emit every step-multiple inside the range. Ticks are generated as integer
 * multiples of `step` via an index loop (not accumulated by repeated
 * addition), and rounded to `step`'s own decimal precision, so labels read
 * "0.5" rather than "0.49999999999999994" from float accumulation drift.
 */
export function computeNiceTicks(min: number, max: number, targetCount = 6): number[] {
  if (!(max > min) || targetCount < 1) return [];
  const roughStep = (max - min) / targetCount;
  const exponent = Math.floor(Math.log10(roughStep));
  const magnitude = 10 ** exponent;
  const residual = roughStep / magnitude;
  const niceResidual = residual > 5 ? 10 : residual > 2 ? 5 : residual > 1 ? 2 : 1;
  const step = niceResidual * magnitude;
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const startIndex = Math.ceil(min / step - 1e-9);
  const endIndex = Math.floor(max / step + 1e-9);
  const ticks: number[] = [];
  for (let i = startIndex; i <= endIndex; i++) {
    ticks.push(Number((i * step).toFixed(decimals)));
  }
  return ticks;
}

/**
 * Draw x/y axis lines + numeric tick marks (issue #150 — nearly every panel
 * had no coordinate reference at all). Reads theme colors itself (matching
 * `drawCayleyTable`'s self-contained convention) so call sites stay a single
 * line: `theme.muted` for the axis lines/tick marks, `theme.ink` for labels.
 *
 * Axis lines sit at the true data-value-0 position when it's within the
 * viewport; when panning/zooming has moved the viewport entirely to one
 * side of zero, that axis (and its ticks) hugs the nearest screen edge
 * instead of vanishing off-canvas -- standard graphing-calculator behavior,
 * so ticks stay legible while panning. Tick labels flip to the inward side
 * whenever the default side would otherwise clip off-canvas (x-axis labels
 * flip from below to above when hugging the bottom edge; y-axis labels flip
 * from left to right when hugging the left edge).
 *
 * The origin's "0" label is only ever drawn once (on the y-axis) even
 * though 0 can appear in both tick sets, to avoid two overlapping "0"s at
 * the origin when both axes are in view.
 */
export function drawAxes(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  width: number,
  height: number,
  options: { targetTickCount?: number } = {},
): void {
  const { xMin, xMax, yMin, yMax } = viewport;
  if (!(xMax > xMin) || !(yMax > yMin)) return;
  const theme = getThemeColors();
  const targetTickCount = options.targetTickCount ?? 6;
  const tickHalf = 4;

  // >= / <= (not > / <), issue #313: a viewport with min exactly 0 (every
  // zero-based chart -- the signal spectrum/correlation/PSD, loss curves)
  // puts the axis ON the canvas edge; the strict comparison classified that
  // as "axis in the interior", which flips the label side OUTWARD and
  // renders every tick label just outside the canvas -- clipped, invisible.
  // The tester-visible symptom was "the spectrum has no Hz labels at all."
  const xAxisAtBottom = yMin >= 0; // viewport at/above y=0 -> axis line hugs the bottom edge
  const xAxisAtTop = yMax <= 0; // viewport at/below y=0 -> axis line hugs the top edge
  const xAxisSy = xAxisAtBottom ? height : xAxisAtTop ? 0 : toScreenY(0, viewport, height);

  const yAxisAtRight = xMax <= 0; // viewport at/left of x=0 -> axis line hugs the right edge
  const yAxisAtLeft = xMin >= 0; // viewport at/right of x=0 -> axis line hugs the left edge
  const yAxisSx = yAxisAtRight ? width : yAxisAtLeft ? 0 : toScreenX(0, viewport, width);

  ctx.save();
  ctx.strokeStyle = theme.muted;
  ctx.fillStyle = theme.ink;
  ctx.font = "11px system-ui, sans-serif";
  ctx.lineWidth = 1;

  ctx.beginPath();
  ctx.moveTo(0, xAxisSy);
  ctx.lineTo(width, xAxisSy);
  ctx.moveTo(yAxisSx, 0);
  ctx.lineTo(yAxisSx, height);
  ctx.stroke();

  const xLabelBelow = !xAxisAtBottom;
  ctx.textAlign = "center";
  ctx.textBaseline = xLabelBelow ? "top" : "bottom";
  for (const v of computeNiceTicks(xMin, xMax, targetTickCount)) {
    const sx = toScreenX(v, viewport, width);
    ctx.beginPath();
    ctx.moveTo(sx, xAxisSy - tickHalf);
    ctx.lineTo(sx, xAxisSy + tickHalf);
    ctx.stroke();
    if (v !== 0) ctx.fillText(String(v), sx, xAxisSy + (xLabelBelow ? tickHalf + 2 : -(tickHalf + 2)));
  }

  const yLabelLeft = !yAxisAtLeft;
  ctx.textAlign = yLabelLeft ? "right" : "left";
  ctx.textBaseline = "middle";
  for (const v of computeNiceTicks(yMin, yMax, targetTickCount)) {
    const sy = toScreenY(v, viewport, height);
    ctx.beginPath();
    ctx.moveTo(yAxisSx - tickHalf, sy);
    ctx.lineTo(yAxisSx + tickHalf, sy);
    ctx.stroke();
    ctx.fillText(String(v), yAxisSx + (yLabelLeft ? -(tickHalf + 4) : tickHalf + 4), sy);
  }

  ctx.restore();
}

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
 * Draw an interval-subdivision guaranteed-coverage enclosure (issue #21,
 * item 1's `sampleImplicitCurveIntervalBoxes`): each leaf box as a filled
 * translucent rectangle, so the overlay reads as a "thickened" curve
 * hugging every branch the marching-squares trace found (or missed).
 */
export function drawImplicitBoxes(
  ctx: CanvasRenderingContext2D,
  boxes: ImplicitBox[],
  viewport: Viewport,
  width: number,
  height: number,
  color = "rgba(22, 163, 74, 0.5)",
): void {
  ctx.save();
  ctx.fillStyle = color;
  for (const b of boxes) {
    const sx1 = toScreenX(b.xMin, viewport, width);
    const sx2 = toScreenX(b.xMax, viewport, width);
    const sy1 = toScreenY(b.yMax, viewport, height); // data-space y is flipped vs. screen-space y
    const sy2 = toScreenY(b.yMin, viewport, height);
    ctx.fillRect(sx1, sy1, sx2 - sx1, sy2 - sy1);
  }
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
