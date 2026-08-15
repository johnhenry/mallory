import type { Path2D as MalloryPath } from "mallory-math";
import { toScreenX, toScreenY, type Viewport } from "./viewport.ts";

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
 * shading/fills, point handles, and non-`Path2D` layers (scatter,
 * histograms, heatmaps, Three.js scenes) aren't included -- a full SVG
 * backend for every draw function in `render-path.ts` is the issue's own
 * larger, explicitly-deferred follow-up ("the renderer layer's draw
 * functions would need an SVG path backend"). This ships the single most
 * valuable case (a plotted curve) first, the same way PNG export itself
 * started on a "quick win" subset (issue #45's item 3) before later PRs
 * extended coverage panel-by-panel.
 */
export function pathsToSvgDocument(paths: ReadonlyArray<MalloryPath>, viewport: Viewport, width: number, height: number): string {
  const elements = paths.map((path) => {
    const color = `#${path.stroke.color.toString(16).padStart(6, "0")}`;
    const d = pathToSvgD(path, viewport, width, height);
    return `<path d="${d}" fill="none" stroke="${color}" stroke-opacity="${path.stroke.alpha}" stroke-width="${path.stroke.thickness || 1}" />`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n${elements.join("\n")}\n</svg>`;
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
