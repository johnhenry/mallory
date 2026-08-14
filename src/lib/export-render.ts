/**
 * Shared server-only rendering helpers for the export paths (2D expression,
 * 3D surface, ODE) -- the temp-dir render-to-buffer dance and the common
 * palette, extracted when the 3D/ODE paths were added
 * (johnhenry/mallory-graph#3, pass 2). Server-only: imported exclusively by
 * server-fn modules, never by client components directly.
 *
 * Historical note on 3D rendering: ecmanim 0.2.0 built its CanvasRenderer
 * around `options.camera` BEFORE `makeScene` ran, so a ThreeDScene's
 * self-installed ThreeDCamera was never the one the renderer actually
 * projected through -- a ready-made camera had to be threaded in through
 * here as a third parameter. Fixed upstream in ecmanim 0.5.0 (commit
 * b009a91): `render()` now compares `scene.camera` (by reference) against
 * the camera it built initially, and re-binds the renderer + carries over
 * pixelWidth/pixelHeight if the scene swapped in a new one in its own
 * constructor -- so a plain `this.camera = new ThreeDCamera({...})` inside
 * the Scene subclass now works with no external camera threading (see
 * `export-surface-video.ts`). One part of the old workaround is STILL
 * necessary, though: the fix only carries the *background* over via
 * `if (!scene.camera.background) scene.camera.background = background`,
 * but ecmanim's base `Camera` constructor unconditionally defaults
 * `background` to `"#000000"` when not given in its own config -- so a
 * `ThreeDCamera` built without an explicit `background` field is already
 * (truthily) black by the time that check runs, and the automatic
 * carry-through never fires. Confirmed via a standalone probe (distinct
 * frames at different times = camera orientation correctly wired; a
 * `background` omitted from the ThreeDCamera config renders black despite
 * this file's own `background: "#ffffff"` below, an explicit `background`
 * on the camera config renders correctly white) before deleting the old
 * external-camera-threading parameter.
 */
import { render } from "ecmanim/node";
import type { ExportVideoResult } from "./export-jobs.ts";

// Deliberately fixed, not theme-aware (issue #57's "decide the export-video
// policy explicitly" ask): an exported MP4 is a standalone artifact shared
// outside the app, so it shouldn't silently depend on whichever theme the
// exporting user happened to have toggled at export time -- always-light
// output is the stable, predictable choice. If a per-export theme choice is
// ever wanted, it belongs here as an explicit option, not an implicit read
// of the live app theme.
export const AXIS_COLOR = "#334155";
export const LABEL_COLOR = "#111827";
export const CURVE_COLOR = "#3b82f6";
/** Half-height of ecmanim's frame in scene units; the render is square, so the visible half-WIDTH is also this. */
export const SQUARE_HALF_SPAN = 4;

/** Render a construct (bare function or Scene subclass) to a video buffer via a per-job temp dir, cleaned up on every path. */
export async function renderExportToBuffer(sceneOrConstruct: unknown, format: "mp4" | "gif"): Promise<ExportVideoResult> {
  const { promises: fs } = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mallory-graph-export-"));
  const outPath = path.join(dir, `export.${format}`);
  try {
    await render(sceneOrConstruct, {
      output: outPath,
      format,
      fps: 24,
      pixelWidth: 640,
      pixelHeight: 640,
      background: "#ffffff",
      verbose: false,
    });
    const buffer = await fs.readFile(outPath);
    return { data: buffer.toString("base64"), mimeType: format === "gif" ? "image/gif" : "video/mp4" };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
