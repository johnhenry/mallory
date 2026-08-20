/**
 * Server-only ecmanim video/GIF export for CellularAutomataPanel's 2D
 * life-like and 3D totalistic sub-modes (johnhenry/mallory-graph#337). Two
 * independent job-starter server fns, one per sub-mode, since their param
 * shapes and target scene exports differ -- both otherwise mirror
 * `export-ode-video.ts`'s shape exactly (fire-and-forget job, client polls
 * via `export-video.ts`'s shared `getExportVideoJob`).
 */
import { createServerFn } from "@tanstack/react-start";
import { completeExportJob, createExportJob, failExportJob } from "./export-jobs.ts";
import { renderExportToBuffer } from "./export-render.ts";
import type { Ca2dSceneParams, Ca3dSceneParams } from "./scenes/ca-scene.ts";

export type Ca2dExportInput = Ca2dSceneParams & { format: "mp4" | "gif" };
export type Ca3dExportInput = Ca3dSceneParams & { format: "mp4" | "gif" };

/** Path `renderParallel`'s workers `import()` the scene from, resolved
 *  relative to `process.cwd()` -- see export-render.ts's doc comment. */
const SCENE_MODULE_PATH = "src/lib/scenes/ca-scene.ts";

async function runCa2dExportJob(jobId: string, data: Ca2dExportInput) {
  try {
    const { format, ...params } = data;
    completeExportJob(jobId, await renderExportToBuffer(SCENE_MODULE_PATH, "construct2d", params, format));
  } catch (e) {
    failExportJob(jobId, e);
  }
}

export const startCa2dExportJob = createServerFn({ method: "POST" })
  .validator((data: Ca2dExportInput) => data)
  .handler(async ({ data }) => {
    if (!(data.duration > 0)) throw new Error("Export duration must be positive.");
    const jobId = createExportJob();
    void runCa2dExportJob(jobId, data);
    return { jobId };
  });

async function runCa3dExportJob(jobId: string, data: Ca3dExportInput) {
  try {
    const { format, ...params } = data;
    completeExportJob(jobId, await renderExportToBuffer(SCENE_MODULE_PATH, "CaVoxelExportScene", params, format));
  } catch (e) {
    failExportJob(jobId, e);
  }
}

export const startCa3dExportJob = createServerFn({ method: "POST" })
  .validator((data: Ca3dExportInput) => data)
  .handler(async ({ data }) => {
    if (!(data.duration > 0)) throw new Error("Export duration must be positive.");
    const jobId = createExportJob();
    void runCa3dExportJob(jobId, data);
    return { jobId };
  });
