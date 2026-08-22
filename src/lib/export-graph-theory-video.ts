/**
 * Server-only ecmanim video/GIF export for GraphTheoryPanel's algorithm-step
 * animation (johnhenry/mallory#337). Mirrors `export-ode-video.ts`'s
 * shape exactly (fire-and-forget job, client polls via `export-video.ts`'s
 * shared `getExportVideoJob`).
 */
import { createServerFn } from "@tanstack/react-start";
import { completeExportJob, createExportJob, failExportJob } from "./export-jobs.ts";
import { renderExportToBuffer } from "./export-render.ts";
import type { GraphTheorySceneParams } from "./scenes/graph-theory-scene.ts";

export type GraphTheoryExportInput = GraphTheorySceneParams & { format: "mp4" | "gif" };

/** Path `renderParallel`'s workers `import()` the scene from, resolved
 *  relative to `process.cwd()` -- see export-render.ts's doc comment. */
const SCENE_MODULE_PATH = "src/lib/scenes/graph-theory-scene.ts";
const SCENE_EXPORT_NAME = "construct";

async function runGraphTheoryExportJob(jobId: string, data: GraphTheoryExportInput) {
  try {
    const { format, ...params } = data;
    completeExportJob(jobId, await renderExportToBuffer(SCENE_MODULE_PATH, SCENE_EXPORT_NAME, params, format));
  } catch (e) {
    failExportJob(jobId, e);
  }
}

export const startGraphTheoryExportJob = createServerFn({ method: "POST" })
  .validator((data: GraphTheoryExportInput) => data)
  .handler(async ({ data }) => {
    if (!(data.duration > 0)) throw new Error("Export duration must be positive.");
    const jobId = createExportJob();
    void runGraphTheoryExportJob(jobId, data);
    return { jobId };
  });
