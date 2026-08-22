/**
 * Server-only ecmanim video/GIF export for MlPlaygroundPanel's decision-
 * boundary training animation (johnhenry/mallory#337). Mirrors
 * `export-ode-video.ts`'s single-scene shape exactly: a `startMlExportJob`
 * server fn forwards the raw request `data` through as the scene's
 * `params` (see `ml-scene.ts`'s `construct`), fire-and-forget, polled via
 * `export-video.ts`'s shared `getExportVideoJob`.
 */
import { createServerFn } from "@tanstack/react-start";
import { completeExportJob, createExportJob, failExportJob } from "./export-jobs.ts";
import { renderExportToBuffer } from "./export-render.ts";
import type { MlSceneParams } from "./scenes/ml-scene.ts";

export type MlExportInput = MlSceneParams & { format: "mp4" | "gif" };

/** Path `renderParallel`'s workers `import()` the scene from, resolved
 *  relative to `process.cwd()` -- see export-render.ts's doc comment. */
const SCENE_MODULE_PATH = "src/lib/scenes/ml-scene.ts";
const SCENE_EXPORT_NAME = "construct";

async function runMlExportJob(jobId: string, data: MlExportInput) {
  try {
    const { format, ...params } = data;
    completeExportJob(jobId, await renderExportToBuffer(SCENE_MODULE_PATH, SCENE_EXPORT_NAME, params, format));
  } catch (e) {
    failExportJob(jobId, e);
  }
}

export const startMlExportJob = createServerFn({ method: "POST" })
  .validator((data: MlExportInput) => data)
  .handler(async ({ data }) => {
    if (!(data.duration > 0)) throw new Error("Export duration must be positive.");
    if (data.points.length === 0) throw new Error("Dataset is empty.");
    const jobId = createExportJob();
    // Not awaited: renders in the background; the client polls via
    // export-video.ts's getExportVideoJob (one shared store/poll endpoint).
    void runMlExportJob(jobId, data);
    return { jobId };
  });
