/**
 * A safe PNG filename for a given panel/export label, e.g. "graphing" ->
 * "mallory-graphing.png" -- mirrors GraphCanvas's own existing
 * "mallory-export.<ext>" video-export naming convention. Pure and
 * DOM-free (unlike `downloadCanvasPng` below) so it's directly unit
 * testable.
 */
export function pngExportFilename(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `mallory-${slug || "export"}.png`;
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

/**
 * The 2x-scale "crisp" export (issue #45's remaining scope, item 2): a
 * genuine higher-resolution RE-RENDER, not an interpolated upscale of the
 * on-screen raster -- `render` is the panel's own pure draw function
 * (already parameterized over `(ctx, width, height)`, matching every
 * `draw*` helper in render-path.ts/heatmap.ts/etc.), called against a
 * fresh offscreen canvas sized `baseWidth*scale x baseHeight*scale`. Every
 * data-space-to-screen-space calculation inside `render` naturally scales
 * with `width`/`height`, so text/line widths that are already computed
 * relative to canvas size come out crisp; anything hardcoded in absolute
 * pixels (a fixed `ctx.lineWidth = 1`, say) won't scale -- same caveat
 * `render`'s own panel-specific implementation is responsible for, same as
 * the on-screen 1x render already is.
 */
export function downloadCanvasPngAtScale(
  baseWidth: number,
  baseHeight: number,
  scale: number,
  render: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
  filename: string,
): Promise<void> {
  const canvas = document.createElement("canvas");
  canvas.width = baseWidth * scale;
  canvas.height = baseHeight * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("Could not get a 2D context for the offscreen export canvas."));
  render(ctx, canvas.width, canvas.height);
  return downloadCanvasPng(canvas, filename);
}

/**
 * The Three.js/WebGL equivalent of `downloadCanvasPngAtScale` (issue #278):
 * a genuine higher-resolution re-render, done by handing a fresh, correctly-
 * sized offscreen `<canvas>` to `render` and letting the CALLER build a
 * temporary `THREE.WebGLRenderer` around it (with `preserveDrawingBuffer:
 * true`, matching every on-screen renderer's own #101 setup) and call
 * `renderer.render(scene, camera)` once against it -- this module stays
 * Three.js-agnostic (no `three` import) since `render` fully owns the
 * WebGL side, including disposing its temporary renderer when done.
 * Reusing the SAME scene/camera objects the on-screen renderer already
 * built is safe -- rendering a scene/camera pair through a second renderer
 * doesn't mutate either, so the live on-screen canvas is never touched or
 * left in a resized/restored state.
 */
export function downloadThreeCanvasPngAtScale(
  baseWidth: number,
  baseHeight: number,
  scale: number,
  render: (canvas: HTMLCanvasElement, width: number, height: number) => void,
  filename: string,
): Promise<void> {
  const canvas = document.createElement("canvas");
  canvas.width = baseWidth * scale;
  canvas.height = baseHeight * scale;
  render(canvas, canvas.width, canvas.height);
  return downloadCanvasPng(canvas, filename);
}
