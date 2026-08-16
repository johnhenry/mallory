import type { Path2D as MalloryPath } from "mallory-math";
import { computeNiceTicks } from "./render-path.ts";
import { getThemeColors } from "./theme-colors.ts";
import { toScreenX, toScreenY, type Viewport } from "./viewport.ts";

/**
 * Joins axes elements (possibly empty) and content elements (possibly
 * empty) into one `<svg>` document body -- factored out so an empty `axes`
 * string never leaves a stray blank line behind (unlike naive template
 * interpolation of an optional block), keeping the axes=false output
 * byte-identical to this file's pre-#150 documents.
 */
function svgDocument(width: number, height: number, axesSvg: string, contentSvg: string): string {
  const body = [axesSvg, contentSvg].filter((s) => s.length > 0).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n${body}\n</svg>`;
}

/** A safe SVG filename for a given panel/export label -- mirrors canvas-export.ts's `pngExportFilename`. */
export function svgExportFilename(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `mallory-graph-${slug || "export"}.svg`;
}

/**
 * Converts a mallory-math `Path2D`'s `moveTo`/`lineTo` commands (data space)
 * into an SVG `<path>` `d` attribute, applying the same viewport->screen
 * transform `render-path.ts`'s `drawPath` uses for Canvas2D -- so the SVG
 * output matches the on-screen curve exactly, not just approximately.
 */
export function pathToSvgD(path: MalloryPath, viewport: Viewport, width: number, height: number): string {
  const parts: string[] = [];
  for (const cmd of path.commands) {
    const sx = toScreenX(cmd.x, viewport, width);
    const sy = toScreenY(cmd.y, viewport, height);
    parts.push(`${cmd.op === "moveTo" ? "M" : "L"}${sx.toFixed(2)} ${sy.toFixed(2)}`);
  }
  return parts.join(" ");
}

/**
 * Wraps one or more `Path2D`s into a standalone SVG document string --
 * vector output for the same curve(s) `drawPath` renders onto Canvas2D,
 * using the same viewport transform so the two match pixel-for-pixel.
 *
 * v1 scope (issue #45 item 1): only the stroked line itself. Region
 * shading/fills and non-`Path2D` layers other than the polyline/scatter
 * cases below (histograms, heatmaps, Three.js scenes) aren't included --
 * a full SVG backend for every draw function in `render-path.ts` is the
 * issue's own larger, explicitly-deferred follow-up ("the renderer
 * layer's draw functions would need an SVG path backend"). This ships
 * the single most valuable case (a plotted curve) first, the same way
 * PNG export itself started on a "quick win" subset (issue #45's item 3)
 * before later PRs extended coverage panel-by-panel.
 *
 * `axes` (issue #150 item 3, default on to match every canvas panel's own
 * `drawAxes` call): prepends `axesToSvgElements` so exported SVGs carry the
 * same coordinate reference the on-screen canvas does, drawn first so the
 * curve renders on top -- same order `drawAxes`-then-`drawPath` uses on
 * Canvas2D.
 */
export function pathsToSvgDocument(paths: ReadonlyArray<MalloryPath>, viewport: Viewport, width: number, height: number, axes = true): string {
  const elements = paths.map((path) => {
    const color = `#${path.stroke.color.toString(16).padStart(6, "0")}`;
    const d = pathToSvgD(path, viewport, width, height);
    return `<path d="${d}" fill="none" stroke="${color}" stroke-opacity="${path.stroke.alpha}" stroke-width="${path.stroke.thickness || 1}" />`;
  });
  return svgDocument(width, height, axes ? axesToSvgElements(viewport, width, height) : "", elements.join("\n"));
}

/**
 * Converts a plain `{x,y}[]` array (data space) into an SVG `<path>` `d`
 * attribute -- the polyline counterpart to `pathToSvgD`, for callers (a
 * sampled waveform or FFT spectrum) that already have flat point arrays
 * and have no mallory-math `Path2D`, matching `render-path.ts`'s own
 * `drawPolyline`/`drawPath` split.
 */
export function polylinePointsToSvgD(points: ReadonlyArray<{ x: number; y: number }>, viewport: Viewport, width: number, height: number): string {
  return points
    .map((p, i) => {
      const sx = toScreenX(p.x, viewport, width);
      const sy = toScreenY(p.y, viewport, height);
      return `${i === 0 ? "M" : "L"}${sx.toFixed(2)} ${sy.toFixed(2)}`;
    })
    .join(" ");
}

/**
 * Wraps a plain point array into a standalone SVG document -- the
 * `polylinePointsToSvgD` counterpart to `pathsToSvgDocument`, one line
 * only (a `drawPolyline` caller only ever draws a single line per call,
 * unlike `drawPath`'s multi-`Path2D` case). `color`/`strokeWidth` mirror
 * `drawPolyline`'s own CSS-color-string + fixed-1.5px-width convention
 * (a plain CSS color, not mallory-math's `Path2D.stroke`'s packed hex
 * number + separate alpha).
 */
export function polylineToSvgDocument(
  points: ReadonlyArray<{ x: number; y: number }>,
  viewport: Viewport,
  width: number,
  height: number,
  color = "#2563eb",
  strokeWidth = 1.5,
  axes = true,
): string {
  const element =
    points.length === 0 ? "" : `<path d="${polylinePointsToSvgD(points, viewport, width, height)}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" />`;
  return svgDocument(width, height, axes ? axesToSvgElements(viewport, width, height) : "", element);
}

/**
 * Wraps MULTIPLE plain point arrays into a standalone SVG document -- the
 * `polylineToSvgDocument` counterpart to `pathsToSvgDocument`'s multi-line
 * handling, for a caller (e.g. ComplexPanel's conformal grid mapping) that
 * draws several independent `drawPolyline` lines onto one canvas rather
 * than the single-line case `polylineToSvgDocument` covers. Empty lines are
 * skipped (matching `polylineToSvgDocument`'s own empty-array behavior)
 * rather than emitting a stray zero-length `<path>`.
 */
export function polylinesToSvgDocument(
  lines: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>,
  viewport: Viewport,
  width: number,
  height: number,
  color = "#2563eb",
  strokeWidth = 1.5,
  axes = true,
): string {
  const elements = lines
    .filter((line) => line.length > 0)
    .map((line) => `<path d="${polylinePointsToSvgD(line, viewport, width, height)}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" />`);
  return svgDocument(width, height, axes ? axesToSvgElements(viewport, width, height) : "", elements.join("\n"));
}

/**
 * Wraps a plain point array into a standalone SVG document as `<circle>`
 * elements -- the `drawScatter` counterpart to `polylineToSvgDocument`, for
 * a finite-structure/roots/extrema marker overlay rather than a connected
 * line. `color`/`radius` mirror `drawScatter`'s own CSS-color-string +
 * fixed-radius convention.
 */
export function scatterPointsToSvgDocument(
  points: ReadonlyArray<{ x: number; y: number }>,
  viewport: Viewport,
  width: number,
  height: number,
  color = "#2563eb",
  radius = 5,
  axes = true,
): string {
  const elements = points.map((p) => {
    const sx = toScreenX(p.x, viewport, width);
    const sy = toScreenY(p.y, viewport, height);
    return `<circle cx="${sx.toFixed(2)}" cy="${sy.toFixed(2)}" r="${radius}" fill="${color}" />`;
  });
  return svgDocument(width, height, axes ? axesToSvgElements(viewport, width, height) : "", elements.join("\n"));
}

/**
 * One drawn layer for `layersToSvgDocument` -- a `drawPolyline`-style
 * connected line, a `drawScatter`-style set of markers, a `drawPath`-style
 * mallory-math `Path2D` (its own stroke color/alpha/thickness, same as
 * `pathsToSvgDocument`, rather than the `color`/`strokeWidth` overrides the
 * plain-point-array kinds take), a `drawHistogram`-style set of bin bars,
 * a `drawSlopeField`-style grid of undirected tangent-line segments, a
 * `drawVectorField`-style grid of directed arrows (a line + filled
 * `<polygon>` arrowhead per point; points whose magnitude is below 1e-12
 * are skipped, matching `drawVectorField`'s own `continue`), or a filled
 * confidence-band-style region between an upper and lower boundary sharing
 * the same x-coordinates (e.g. MonteCarloPanel's integrand error band) --
 * one `<polygon>` tracing the upper boundary forward then the lower
 * boundary backward, matching the `ctx.fill()`-a-closed-path technique the
 * Canvas2D draw effect uses, or a per-point color-and-text marker (e.g.
 * OdeSystemPanel's classified fixed-point circles, each stroked in the
 * theme's ink color with a short label offset above-right, matching the
 * Canvas2D draw effect's `ctx.fillText` placement exactly). A `polyline`
 * layer's optional `dash` maps straight to SVG's
 * `stroke-dasharray` -- for a `ctx.setLineDash([...])` reference line (e.g.
 * MonteCarloPanel's dashed pi-estimate line) alongside solid layers on the
 * same canvas.
 */
export type SvgLayer =
  | { kind: "polyline"; points: ReadonlyArray<{ x: number; y: number }>; color?: string; strokeWidth?: number; dash?: readonly number[] }
  | { kind: "scatter"; points: ReadonlyArray<{ x: number; y: number }>; color?: string; radius?: number }
  | { kind: "path"; path: MalloryPath }
  | { kind: "histogram"; bins: ReadonlyArray<{ x0: number; x1: number; count: number }>; color?: string; strokeColor?: string }
  | { kind: "slopefield"; points: ReadonlyArray<{ x: number; y: number; slope: number }>; halfLengthPx?: number; color?: string }
  | { kind: "vectorfield"; points: ReadonlyArray<{ x: number; y: number; dx: number; dy: number }>; halfLengthPx?: number; color?: string }
  | { kind: "band"; points: ReadonlyArray<{ x: number; yLow: number; yHigh: number }>; color?: string }
  | { kind: "labeled-markers"; points: ReadonlyArray<{ x: number; y: number; color: string; label: string }>; radius?: number };

/**
 * Wraps MULTIPLE layers of possibly-different kinds (polyline, scatter,
 * and/or path) into one standalone SVG document -- issue #45 item 1's
 * "quick win" tier: a panel like StatisticsPanel's smoothing view draws a
 * scatter layer (raw data) UNDER a polyline layer (the smoothed curve) on
 * the SAME canvas, and RegressionPanel draws a scatter layer (data points)
 * plus a `Path2D` fit line plus an outlier-highlight scatter layer --
 * combinations no single existing document builder (`polylineToSvgDocument`
 * one line only, `scatterPointsToSvgDocument` markers only,
 * `pathsToSvgDocument` `Path2D`s only) can reproduce alone. Layers are
 * drawn in array order (same as their Canvas2D draw calls), each
 * point-array kind falling back to `drawPolyline`/`drawScatter`'s own
 * blue/1.5px and blue/5px defaults respectively; a `path` layer's color/
 * alpha/thickness always come from the `Path2D`'s own `stroke`, same as
 * `pathsToSvgDocument`; a `histogram` layer falls back to `drawHistogram`'s
 * own light-blue-fill/blue-stroke defaults, one `<rect>` per bin (x/y/
 * width/height normalized to non-negative -- SVG rejects a negative
 * width/height outright, unlike `ctx.fillRect`, which just draws the
 * opposite direction). An empty `layers` array or an individual empty
 * layer (no points, no bins, or a path with no commands) all degrade
 * gracefully (no stray empty elements), matching `polylinesToSvgDocument`'s
 * own empty-line skipping.
 */
export function layersToSvgDocument(layers: readonly SvgLayer[], viewport: Viewport, width: number, height: number, axes = true): string {
  const elements = layers
    .filter((layer) => {
      if (layer.kind === "path") return layer.path.commands.length > 0;
      if (layer.kind === "histogram") return layer.bins.length > 0;
      return layer.points.length > 0;
    })
    .map((layer) => {
      if (layer.kind === "path") {
        const color = `#${layer.path.stroke.color.toString(16).padStart(6, "0")}`;
        const d = pathToSvgD(layer.path, viewport, width, height);
        return `<path d="${d}" fill="none" stroke="${color}" stroke-opacity="${layer.path.stroke.alpha}" stroke-width="${layer.path.stroke.thickness || 1}" />`;
      }
      if (layer.kind === "histogram") {
        const color = layer.color ?? "#93c5fd";
        const strokeColor = layer.strokeColor ?? "#2563eb";
        const zeroY = toScreenY(0, viewport, height);
        return layer.bins
          .map((bin) => {
            const sx0 = toScreenX(bin.x0, viewport, width);
            const sx1 = toScreenX(bin.x1, viewport, width);
            const sy = toScreenY(bin.count, viewport, height);
            const x = Math.min(sx0, sx1);
            const rectWidth = Math.abs(sx1 - sx0);
            const y = Math.min(sy, zeroY);
            const rectHeight = Math.abs(zeroY - sy);
            return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${rectWidth.toFixed(2)}" height="${rectHeight.toFixed(2)}" fill="${color}" stroke="${strokeColor}" stroke-width="1" />`;
          })
          .join("\n");
      }
      if (layer.kind === "polyline") {
        const color = layer.color ?? "#2563eb";
        const strokeWidth = layer.strokeWidth ?? 1.5;
        const dashAttr = layer.dash && layer.dash.length > 0 ? ` stroke-dasharray="${layer.dash.join(" ")}"` : "";
        return `<path d="${polylinePointsToSvgD(layer.points, viewport, width, height)}" fill="none" stroke="${color}" stroke-width="${strokeWidth}"${dashAttr} />`;
      }
      if (layer.kind === "slopefield") {
        const color = layer.color ?? "rgba(37, 99, 235, 0.5)";
        const halfLengthPx = layer.halfLengthPx ?? 8;
        return layer.points
          .map((p) => {
            const sx = toScreenX(p.x, viewport, width);
            const sy = toScreenY(p.y, viewport, height);
            // Screen-space y is flipped vs. data-space y, matching drawSlopeField's own angle convention.
            const angle = Math.atan2(-p.slope, 1);
            const dx = Math.cos(angle) * halfLengthPx;
            const dy = Math.sin(angle) * halfLengthPx;
            return `<line x1="${(sx - dx).toFixed(2)}" y1="${(sy - dy).toFixed(2)}" x2="${(sx + dx).toFixed(2)}" y2="${(sy + dy).toFixed(2)}" stroke="${color}" stroke-width="1.5" />`;
          })
          .join("\n");
      }
      if (layer.kind === "vectorfield") {
        const color = layer.color ?? "rgba(37, 99, 235, 0.55)";
        const halfLengthPx = layer.halfLengthPx ?? 8;
        return layer.points
          .filter((p) => Math.hypot(p.dx, p.dy) >= 1e-12)
          .map((p) => {
            const mag = Math.hypot(p.dx, p.dy);
            const sx = toScreenX(p.x, viewport, width);
            const sy = toScreenY(p.y, viewport, height);
            // Screen-space y is flipped vs. data-space y, matching drawVectorField's own convention.
            const ux = p.dx / mag;
            const uy = -p.dy / mag;
            const tipX = sx + ux * halfLengthPx;
            const tipY = sy + uy * halfLengthPx;
            const tailX = sx - ux * halfLengthPx;
            const tailY = sy - uy * halfLengthPx;
            const arrowAngle = Math.atan2(tipY - tailY, tipX - tailX);
            const headLen = halfLengthPx * 0.6;
            const leftX = tipX - headLen * Math.cos(arrowAngle - Math.PI / 6);
            const leftY = tipY - headLen * Math.sin(arrowAngle - Math.PI / 6);
            const rightX = tipX - headLen * Math.cos(arrowAngle + Math.PI / 6);
            const rightY = tipY - headLen * Math.sin(arrowAngle + Math.PI / 6);
            const shaft = `<line x1="${tailX.toFixed(2)}" y1="${tailY.toFixed(2)}" x2="${tipX.toFixed(2)}" y2="${tipY.toFixed(2)}" stroke="${color}" stroke-width="1.5" />`;
            const head = `<polygon points="${tipX.toFixed(2)},${tipY.toFixed(2)} ${leftX.toFixed(2)},${leftY.toFixed(2)} ${rightX.toFixed(2)},${rightY.toFixed(2)}" fill="${color}" />`;
            return `${shaft}\n${head}`;
          })
          .join("\n");
      }
      if (layer.kind === "band") {
        const color = layer.color ?? "rgba(37, 99, 235, 0.15)";
        const upper = layer.points.map((p) => `${toScreenX(p.x, viewport, width).toFixed(2)},${toScreenY(p.yHigh, viewport, height).toFixed(2)}`);
        const lower = [...layer.points]
          .reverse()
          .map((p) => `${toScreenX(p.x, viewport, width).toFixed(2)},${toScreenY(p.yLow, viewport, height).toFixed(2)}`);
        return `<polygon points="${[...upper, ...lower].join(" ")}" fill="${color}" />`;
      }
      if (layer.kind === "labeled-markers") {
        const theme = getThemeColors();
        const radius = layer.radius ?? 6;
        return layer.points
          .map((p) => {
            const sx = toScreenX(p.x, viewport, width);
            const sy = toScreenY(p.y, viewport, height);
            const circle = `<circle cx="${sx.toFixed(2)}" cy="${sy.toFixed(2)}" r="${radius}" fill="${p.color}" stroke="${theme.ink}" stroke-width="1.5" />`;
            const text = `<text x="${(sx + 9).toFixed(2)}" y="${(sy - 9).toFixed(2)}" fill="${theme.ink}" font-size="11" font-family="sans-serif">${p.label}</text>`;
            return `${circle}\n${text}`;
          })
          .join("\n");
      }
      const color = layer.color ?? "#2563eb";
      const radius = layer.radius ?? 5;
      return layer.points
        .map((p) => {
          const sx = toScreenX(p.x, viewport, width);
          const sy = toScreenY(p.y, viewport, height);
          return `<circle cx="${sx.toFixed(2)}" cy="${sy.toFixed(2)}" r="${radius}" fill="${color}" />`;
        })
        .join("\n");
    });
  return svgDocument(width, height, axes ? axesToSvgElements(viewport, width, height) : "", elements.join("\n"));
}

/**
 * SVG counterpart to `render-path.ts`'s `drawAxes` (issue #150 item 3):
 * same nice-tick spacing, same edge-hugging when the viewport is entirely
 * on one side of zero, same label-flip-to-inward-side to avoid off-canvas
 * clipping, same single "0" label at the origin. Emitted as plain `<line>`/
 * `<text>` elements rather than a `<g>` with CSS classes, matching this
 * file's existing element style (inline `stroke`/`fill` attributes, no
 * external stylesheet dependency, so the SVG renders correctly even when
 * opened standalone outside the app).
 */
export function axesToSvgElements(viewport: Viewport, width: number, height: number, options: { targetTickCount?: number } = {}): string {
  const { xMin, xMax, yMin, yMax } = viewport;
  if (!(xMax > xMin) || !(yMax > yMin)) return "";
  const theme = getThemeColors();
  const targetTickCount = options.targetTickCount ?? 6;
  const tickHalf = 4;

  const xAxisAtBottom = yMin > 0;
  const xAxisAtTop = yMax < 0;
  const xAxisSy = xAxisAtBottom ? height : xAxisAtTop ? 0 : toScreenY(0, viewport, height);

  const yAxisAtRight = xMax < 0;
  const yAxisAtLeft = xMin > 0;
  const yAxisSx = yAxisAtRight ? width : yAxisAtLeft ? 0 : toScreenX(0, viewport, width);

  const elements: string[] = [
    `<line x1="0" y1="${xAxisSy}" x2="${width}" y2="${xAxisSy}" stroke="${theme.muted}" stroke-width="1" />`,
    `<line x1="${yAxisSx}" y1="0" x2="${yAxisSx}" y2="${height}" stroke="${theme.muted}" stroke-width="1" />`,
  ];

  const xLabelBelow = !xAxisAtBottom;
  const xBaseline = xLabelBelow ? "hanging" : "auto";
  for (const v of computeNiceTicks(xMin, xMax, targetTickCount)) {
    const sx = toScreenX(v, viewport, width);
    elements.push(`<line x1="${sx.toFixed(2)}" y1="${(xAxisSy - tickHalf).toFixed(2)}" x2="${sx.toFixed(2)}" y2="${(xAxisSy + tickHalf).toFixed(2)}" stroke="${theme.muted}" stroke-width="1" />`);
    if (v !== 0) {
      const ty = xAxisSy + (xLabelBelow ? tickHalf + 2 : -(tickHalf + 2));
      elements.push(
        `<text x="${sx.toFixed(2)}" y="${ty.toFixed(2)}" fill="${theme.ink}" font-size="11" font-family="system-ui, sans-serif" text-anchor="middle" dominant-baseline="${xBaseline}">${v}</text>`,
      );
    }
  }

  const yLabelLeft = !yAxisAtLeft;
  const yAnchor = yLabelLeft ? "end" : "start";
  for (const v of computeNiceTicks(yMin, yMax, targetTickCount)) {
    const sy = toScreenY(v, viewport, height);
    elements.push(`<line x1="${(yAxisSx - tickHalf).toFixed(2)}" y1="${sy.toFixed(2)}" x2="${(yAxisSx + tickHalf).toFixed(2)}" y2="${sy.toFixed(2)}" stroke="${theme.muted}" stroke-width="1" />`);
    const tx = yAxisSx + (yLabelLeft ? -(tickHalf + 4) : tickHalf + 4);
    elements.push(`<text x="${tx.toFixed(2)}" y="${sy.toFixed(2)}" fill="${theme.ink}" font-size="11" font-family="system-ui, sans-serif" text-anchor="${yAnchor}" dominant-baseline="middle">${v}</text>`);
  }

  return elements.join("\n");
}

/**
 * Downloads an SVG document string as a file -- a `Blob` + anchor-click
 * download, the same pattern `canvas-export.ts`'s `downloadCanvasPng` uses
 * for PNGs (no `toBlob()` step needed here since the SVG is already a
 * plain string, not raster pixel data).
 */
export function downloadSvg(svg: string, filename: string): void {
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
