/**
 * Server-only ecmanim video/GIF export for a first-order ODE
 * (johnhenry/mallory-graph#3, pass 2) -- the /ode page previously had no
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
 * johnhenry/mallory-graph#210: the scene script used to be built here as an
 * in-request closure (`buildOdeConstruct`). It now lives at
 * `./scenes/ode-scene.ts` as a top-level exported `construct(scene, params)`
 * -- required so `renderExportToBuffer`'s `renderParallel` call can shard
 * the render across worker_threads (each worker `import()`s the scene by
 * file path + export name). This file now just forwards the raw request
 * `data` through as `params`.
 */
import { createServerFn } from "@tanstack/react-start";
import { completeExportJob, createExportJob, failExportJob } from "./export-jobs.ts";
import { renderExportToBuffer } from "./export-render.ts";
import type { OdeSceneParams } from "./scenes/ode-scene.ts";

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
