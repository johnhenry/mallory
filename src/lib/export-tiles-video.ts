/**
 * Server-only ecmanim video/GIF export for TilesPanel's primary Wang-tile
 * solve animation (johnhenry/mallory-graph#337). Mirrors
 * `export-ode-video.ts`'s shape exactly (fire-and-forget job, client polls
 * via `export-video.ts`'s shared `getExportVideoJob`).
 */
import { createServerFn } from "@tanstack/react-start";
import { completeExportJob, createExportJob, failExportJob } from "./export-jobs.ts";
import { renderExportToBuffer } from "./export-render.ts";
import type { TilesSceneParams } from "./scenes/tiles-scene.ts";

export type TilesExportInput = TilesSceneParams & { format: "mp4" | "gif" };

/** Path `renderParallel`'s workers `import()` the scene from, resolved
 *  relative to `process.cwd()` -- see export-render.ts's doc comment. */
const SCENE_MODULE_PATH = "src/lib/scenes/tiles-scene.ts";
const SCENE_EXPORT_NAME = "construct";

async function runTilesExportJob(jobId: string, data: TilesExportInput) {
  try {
    const { format, ...params } = data;
    completeExportJob(jobId, await renderExportToBuffer(SCENE_MODULE_PATH, SCENE_EXPORT_NAME, params, format));
  } catch (e) {
    failExportJob(jobId, e);
  }
}

export const startTilesExportJob = createServerFn({ method: "POST" })
  .validator((data: TilesExportInput) => data)
  .handler(async ({ data }) => {
    if (!(data.duration > 0)) throw new Error("Export duration must be positive.");
    const jobId = createExportJob();
    void runTilesExportJob(jobId, data);
    return { jobId };
  });
