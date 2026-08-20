/**
 * Server-only ecmanim video/GIF export for StreamingDatasetPanel's Demo A
 * ("watch epochs reshuffle") -- johnhenry/mallory-graph#337. Mirrors
 * `export-ode-video.ts`'s shape exactly: a single job-starter server fn
 * (only one scene target here, unlike `export-ca-video.ts`'s 2D/3D pair)
 * that fires a background job and lets the client poll it via
 * `export-video.ts`'s shared `getExportVideoJob`.
 */
import { createServerFn } from "@tanstack/react-start";
import { completeExportJob, createExportJob, failExportJob } from "./export-jobs.ts";
import { renderExportToBuffer } from "./export-render.ts";
import type { SceneParams } from "./scenes/streaming-scene.ts";

export type StreamingExportInput = SceneParams & { format: "mp4" | "gif" };

/** Path `renderParallel`'s workers `import()` the scene from, resolved
 *  relative to `process.cwd()` -- see export-render.ts's doc comment. */
const SCENE_MODULE_PATH = "src/lib/scenes/streaming-scene.ts";
const SCENE_EXPORT_NAME = "construct";

async function runStreamingExportJob(jobId: string, data: StreamingExportInput) {
  try {
    const { format, ...params } = data;
    completeExportJob(jobId, await renderExportToBuffer(SCENE_MODULE_PATH, SCENE_EXPORT_NAME, params, format));
  } catch (e) {
    failExportJob(jobId, e);
  }
}

export const startStreamingExportJob = createServerFn({ method: "POST" })
  .validator((data: StreamingExportInput) => data)
  .handler(async ({ data }) => {
    if (!(data.duration > 0)) throw new Error("Export duration must be positive.");
    const jobId = createExportJob();
    // Not awaited: renders in the background; the client polls via
    // export-video.ts's getExportVideoJob (one shared store/poll endpoint).
    void runStreamingExportJob(jobId, data);
    return { jobId };
  });
