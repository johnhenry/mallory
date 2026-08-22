/**
 * Server-only ecmanim video/GIF export for a first-order ODE
 * (johnhenry/mallory#3, pass 2) -- the /ode page previously had no
 * export path. The scene shows the slope field as an ArrowVectorField and
 * the RK4 solution progressively traced from the initial condition: a
 * TracedPath trails a moving dot per direction (one growing forward from
 * (x0, y0), one backward), driven by one linear ValueTracker -- the
 * pedagogically classic "watch the solution evolve from its initial
 * condition", matching the panel's own both-directions plot. StreamLines
 * (continuously flowing field animation) was considered and skipped: the
 * static arrows plus the moving trace already carry the story, and
 * StreamLines' per-frame line rebuilding is the slowest mobject in the
 * family.
 *
 * ArrowVectorField's function speaks *scene* coordinates (manim
 * convention): each sampled scene point is mapped back to data space via
 * axes.p2c, the slope evaluated there, and the unit direction (1, y')
 * mapped forward again through axes.c2p as a scene-space delta -- so the
 * arrows anchor to the same axes the solution curve plots against.
 *
 * The trajectory reuses sampleOdeSolution (the exact sampler the live
 * panel plots with, RK4 in both directions with non-finite cutoffs) and
 * splits its x-ascending point list at the initial condition's seam.
 *
 * johnhenry/mallory#210: the scene script used to be built here as an
 * in-request closure (`buildOdeConstruct`). It now lives at
 * `./scenes/ode-scene.ts` as a top-level exported `construct(scene, params)`
 * -- required so `renderExportToBuffer`'s `renderParallel` call can shard
 * the render across worker_threads (each worker `import()`s the scene by
 * file path + export name). This file now just forwards the raw request
 * `data` through as `params`.
 */
import { createServerFn } from "@tanstack/react-start";
import { renderStill } from "ecmanim/node";
import { completeExportJob, createExportJob, failExportJob, type ExportVideoResult } from "./export-jobs.ts";
import { renderExportToBuffer } from "./export-render.ts";
import { construct, type OdeSceneParams } from "./scenes/ode-scene.ts";

export type OdeExportInput = OdeSceneParams & { format: "mp4" | "gif" };

/** Path `renderParallel`'s workers `import()` the scene from, resolved
 *  relative to `process.cwd()` -- see export-render.ts's doc comment. */
const SCENE_MODULE_PATH = "src/lib/scenes/ode-scene.ts";
const SCENE_EXPORT_NAME = "construct";

async function runOdeExportJob(jobId: string, data: OdeExportInput) {
  try {
    const { format, ...params } = data;
    completeExportJob(jobId, await renderExportToBuffer(SCENE_MODULE_PATH, SCENE_EXPORT_NAME, params, format));
  } catch (e) {
    failExportJob(jobId, e);
  }
}

export const startOdeExportJob = createServerFn({ method: "POST" })
  .validator((data: OdeExportInput) => data)
  .handler(async ({ data }) => {
    if (!(data.duration > 0)) throw new Error("Export duration must be positive.");
    const jobId = createExportJob();
    // Not awaited: renders in the background; the client polls via
    // export-video.ts's getExportVideoJob (one shared store/poll endpoint).
    void runOdeExportJob(jobId, data);
    return { jobId };
  });

/**
 * One PNG frame of the ODE export at `time` seconds, for a scrub preview
 * (issue #337's own "video export with no on-page animation preview" gap --
 * `VideoExportControls` had a `duration`/`onDurationChange` controlled-prop
 * escape hatch since Graph3DCanvas's surface export needed it, but OdePanel
 * originally left both unset). Mirrors `export-surface-video.ts`'s
 * `renderSurfacePreviewFrame` exactly, except `construct` here is a bare
 * function (ode-scene.ts's own shape, matching expression-2d-scene.ts's)
 * rather than a `ThreeDScene` subclass, so `renderStill` is called with the
 * function directly -- the same distinction `export-video.ts`'s own
 * `renderExportPreviewFrame` already draws for the 2D expression scene.
 */
export const renderOdePreviewFrame = createServerFn({ method: "POST" })
  .validator((data: OdeExportInput & { time: number }) => data)
  .handler(async ({ data }): Promise<ExportVideoResult> => {
    const { format: _format, time, ...params } = data;

    const { promises: fs } = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mallory-ode-preview-"));
    const outPath = path.join(dir, "preview.png");
    try {
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
