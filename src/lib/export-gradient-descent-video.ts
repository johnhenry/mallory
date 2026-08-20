/**
 * Server-only ecmanim video/GIF export for GradientDescentPanel's 3D loss
 * surface + racing optimizer paths (johnhenry/mallory-graph#337). Mirrors
 * `export-surface-video.ts`'s shape exactly (fire-and-forget job, client
 * polls via `export-video.ts`'s shared `getExportVideoJob`).
 */
import { createServerFn } from "@tanstack/react-start";
import { completeExportJob, createExportJob, failExportJob } from "./export-jobs.ts";
import { renderExportToBuffer } from "./export-render.ts";
import type { GradientDescentSceneParams } from "./scenes/gradient-descent-scene.ts";

export type GradientDescentExportInput = GradientDescentSceneParams & { format: "mp4" | "gif" };

/** Path `renderParallel`'s workers `import()` the scene from, resolved
 *  relative to `process.cwd()` -- see export-render.ts's doc comment. */
const SCENE_MODULE_PATH = "src/lib/scenes/gradient-descent-scene.ts";
const SCENE_EXPORT_NAME = "GradientDescentExportScene";

async function runGradientDescentExportJob(jobId: string, data: GradientDescentExportInput) {
  try {
    const { format, ...params } = data;
    completeExportJob(jobId, await renderExportToBuffer(SCENE_MODULE_PATH, SCENE_EXPORT_NAME, params, format));
  } catch (e) {
    failExportJob(jobId, e);
  }
}

export const startGradientDescentExportJob = createServerFn({ method: "POST" })
  .validator((data: GradientDescentExportInput) => data)
  .handler(async ({ data }) => {
    if (!(data.duration > 0)) throw new Error("Export duration must be positive.");
    if (data.optimizers.length === 0) throw new Error("Nothing to export: enable at least one optimizer.");
    const jobId = createExportJob();
    void runGradientDescentExportJob(jobId, data);
    return { jobId };
  });
