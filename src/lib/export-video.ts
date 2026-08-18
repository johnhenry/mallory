/**
 * Server-only ecmanim video/GIF export: translates the graph's expression
 * plus its current parameter timeline into a scripted ecmanim Scene
 * (Axes.plot + alwaysRedraw), then renders it to a video/GIF buffer.
 *
 * Drives elapsed time via a real ValueTracker animated through
 * `scene.play(tracker.animate..., {runTime})` -- ecmanim (as of 0.0.11)
 * fixed the bug where a bare `{runTime}` config, without an undocumented
 * internal `_playConfig` marker, silently fell through and crashed
 * (GitHub issue #19), which is exactly what this render loop needs; the
 * 0.2.0 upgrade kept that behavior (verified against a standalone probe
 * render before anything new was built on it).
 * `.animate`'s builder getter takes no config, and its default rate
 * function is an eased `smooth` curve, not linear -- that would make
 * parameters animate non-uniformly in time (speeding up mid-clip, slowing at
 * the edges) versus the straight linear elapsed-time progression this
 * export has always used, so the Transform is constructed directly with
 * `rate_functions.linear` instead of going through `.animate`.
 * `alwaysRedraw` still re-samples the curve every frame straight from
 * `interpolateKeyframes`, reading the tracker's current (per-frame
 * interpolated) value instead of a manually-accumulated `elapsed` variable.
 *
 * ecmanim 0.2.0 additions used here (johnhenry/mallory-graph#3):
 * - `MathTex` typesets the expression's LaTeX (client-supplied, see
 *   `ExportVideoInput.latex`) as an equation label. Static for the whole
 *   clip -- a per-frame-updating label for animated parameters is a
 *   possible future nicety, not built here. MathTex renders via
 *   MathJax->SVG->Beziers, no LaTeX binary; `initMathTex()` is awaited once
 *   per process and construction failure just skips the label rather than
 *   failing the export.
 * - `Flash` plays a brief highlight at each root crossing (computed
 *   server-side from the curve's initial-state sample -- the single-pane
 *   client doesn't have a roots cell to pass, unlike /multi) as a short
 *   prelude before the parameter animation. Roots are of the t=0 curve;
 *   an animated parameter can move them, which the static prelude
 *   deliberately doesn't chase.
 * - `renderStill(construct, {time})` powers the scrub preview: one PNG
 *   frame at an arbitrary time, request/response (no job queue -- a single
 *   frame is fast), so the export UI can show what the clip looks like at
 *   any timestamp before committing to a full render.
 *
 * The default Axes/MathTex colors are manim's white-on-dark convention --
 * invisible against this export's white background -- so both get explicit
 * dark colors.
 *
 * Phase 11b: rendering runs as a background job rather than inside the SSR
 * request -- a long/high-res export would otherwise hold a request open for
 * the render's full wall-clock duration (ffmpeg + per-frame canvas draws),
 * risking proxy/gateway timeouts. The job store is a plain in-memory Map:
 * this app runs as a single Dokku process, so there's no multi-instance
 * fan-out to coordinate and no need for real queue infra (Redis/BullMQ) yet.
 * Jobs are swept on a timer so a browser that never polls again doesn't leak
 * the rendered buffer forever.
 *
 * johnhenry/mallory-graph#210: the scene script used to be built here as an
 * in-request closure (`buildConstruct(data, roots)`), capturing the live
 * HTTP request's data directly. It now lives at
 * `./scenes/expression-2d-scene.ts` as a top-level exported `construct(scene,
 * params)` -- required so `renderExportToBuffer`'s `renderParallel` call can
 * shard the render across worker_threads (each worker `import()`s the scene
 * by file path + export name, so it can't be handed an in-memory closure).
 * This file now just forwards the raw request `data` through as `params`.
 */
import { createServerFn } from "@tanstack/react-start";
import { renderStill } from "ecmanim/node";
import { completeExportJob, createExportJob, failExportJob, readExportJob, type ExportVideoResult } from "./export-jobs.ts";
import { renderExportToBuffer } from "./export-render.ts";
import { construct, type Expression2DSceneParams } from "./scenes/expression-2d-scene.ts";

export type { ExportVideoResult } from "./export-jobs.ts";

export type ExportVideoInput = Expression2DSceneParams & { format: "mp4" | "gif" };

/** Path `renderParallel`'s workers `import()` the scene from, resolved
 *  relative to `process.cwd()` -- see export-render.ts's doc comment. */
const SCENE_MODULE_PATH = "src/lib/scenes/expression-2d-scene.ts";
const SCENE_EXPORT_NAME = "construct";

async function runExportJob(jobId: string, data: ExportVideoInput) {
  try {
    const { format, ...params } = data;
    completeExportJob(jobId, await renderExportToBuffer(SCENE_MODULE_PATH, SCENE_EXPORT_NAME, params, format));
  } catch (e) {
    failExportJob(jobId, e);
  }
}

export const startExportVideoJob = createServerFn({ method: "POST" })
  .validator((data: ExportVideoInput) => data)
  .handler(async ({ data }) => {
    if (data.duration <= 0) {
      throw new Error("Nothing to export: no parameter has a keyframe track.");
    }
    const jobId = createExportJob();
    // Deliberately not awaited: the render runs in the background while this
    // server fn returns immediately with a job id to poll.
    void runExportJob(jobId, data);
    return { jobId };
  });

export const getExportVideoJob = createServerFn({ method: "GET" })
  .validator((data: { jobId: string }) => data)
  .handler(async ({ data }) => {
    const job = readExportJob(data.jobId);
    if (!job) throw new Error("Unknown or expired export job.");
    return job;
  });

/**
 * One PNG frame of the export at `time` seconds, for the scrub-preview
 * slider -- ecmanim's renderStill replays the same construct the full
 * export uses (so the preview can't lie) up to the requested time and
 * renders exactly one frame. Fast enough to be a plain request/response;
 * no job queue involved. Preview is rendered at half the export's
 * resolution since it's a transient UI aid, not the deliverable.
 */
export const renderExportPreviewFrame = createServerFn({ method: "POST" })
  .validator((data: ExportVideoInput & { time: number }) => data)
  .handler(async ({ data }): Promise<ExportVideoResult> => {
    const { format: _format, time, ...params } = data;

    const { promises: fs } = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mallory-graph-preview-"));
    const outPath = path.join(dir, "preview.png");
    try {
      // A single frame is fast enough as a plain in-process call -- no need
      // for renderParallel's worker sharding (or its file-path/export-name
      // indirection) here, so this calls the shared `construct` function
      // directly, same as before #210 just via `params` instead of a closure.
      await renderStill(construct, {
        output: outPath,
        time: Math.max(0, time),
        pixelWidth: 320,
        pixelHeight: 320,
        background: "#ffffff",
        verbose: false,
        params,
      });
      const buffer = await fs.readFile(outPath);
      return { data: buffer.toString("base64"), mimeType: "image/png" };
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
