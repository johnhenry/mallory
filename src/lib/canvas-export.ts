/**
 * A safe PNG filename for a given panel/export label, e.g. "graphing" ->
 * "mallory-graph-graphing.png" -- mirrors GraphCanvas's own existing
 * "mallory-graph-export.<ext>" video-export naming convention. Pure and
 * DOM-free (unlike `downloadCanvasPng` below) so it's directly unit
 * testable.
 */
export function pngExportFilename(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `mallory-graph-${slug || "export"}.png`;
}

/**
 * Downloads a canvas's current raster as a PNG file -- the "quick win" v1 of
 * issue #45's still-export ask: `canvas.toBlob()` + an anchor-click
 * download, the same `URL.createObjectURL`/anchor pattern GraphCanvas's own
 * video export already uses (see its `handleExport`). A true higher-
 * resolution re-render (the issue's own "2x-scale render for crispness"
 * follow-up) needs each panel's draw effect exposed as a reusable
 * `(ctx, width, height)` function first -- deferred, not blocking this
 * quick win, per the issue's own explicit permission ("don't block PNG on
 * [refinements]").
 */
export function downloadCanvasPng(canvas: HTMLCanvasElement, filename: string): Promise<void> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Canvas export failed: toBlob() returned null."));
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      resolve();
    }, "image/png");
  });
}
