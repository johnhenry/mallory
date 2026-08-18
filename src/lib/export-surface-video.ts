/**
 * Server-only ecmanim video/GIF export for a z = f(x, y) surface
 * (johnhenry/mallory-graph#3, pass 2) -- the 3D page previously had no
 * export path at all. The scene is a ThreeDAxes + a function-based Surface
 * (cleaner than importing the client's Three.js mesh data: ecmanim's
 * Surface takes the same (u, v) -> point closure the client's sampler is
 * itself built from, so there's nothing to serialize), animated with a
 * slow full camera orbit over the export's duration -- the compelling
 * default for a 3D clip. The cross-section slider's highlight is NOT
 * animated here; the orbit is the core deliverable (see #3's own
 * "optional flourish" framing).
 *
 * `this.camera = new ThreeDCamera({...})` in the Scene subclass's own
 * constructor is now the idiomatic, ecmanim-0.5.0-and-later pattern for a
 * 3D export -- no external camera threading needed (see
 * `export-render.ts`'s doc comment for the ecmanim-0.2.0 bug this used to
 * work around, how 0.5.0 fixed the *projection* half of it, and why the
 * camera's own `background` config field is still required explicitly
 * despite that fix).
 *
 * A Scene *subclass* (not a bare construct function) is required for 3D:
 * makeScene instantiates a plain 2D Scene for bare functions; only a
 * ThreeDScene drives depth sorting and ambient camera rotation.
 *
 * 3D timeline parity (johnhenry/mallory-graph#3, pass 3): when any free
 * variable has a keyframe track, the surface is no longer static -- it's
 * re-tessellated every frame via `Surface.setFunc` from a `surface.addUpdater`
 * callback, composing for free with the existing camera-orbit
 * `beginAmbientCameraRotation`/`wait` structure (`ThreeDScene.updateMobjects`
 * runs every mobject's updaters during both `scene.play()` and `scene.wait()`
 * -- confirmed in ecmanim's own source, no restructuring needed here). The
 * plain orbit-only (no animated params) path is unchanged: `setFunc` is
 * never called, so there's zero added per-frame cost for the common case.
 *
 * johnhenry/mallory-graph#210: the scene class used to be built here per-job
 * (`buildSurfaceScene(data)`, an anonymous `class ... extends ThreeDScene`
 * closing over the live request's `data`). It now lives at
 * `./scenes/surface-scene.ts` as a single top-level exported
 * `SurfaceExportScene` class that reads `this.params` instead -- required so
 * `renderExportToBuffer`'s `renderParallel` call can shard the render across
 * worker_threads (each worker `import()`s the scene by file path + export
 * name; a fresh anonymous class built per request can't be re-imported by a
 * worker the way a stable module export can). See that file's own doc
 * comment for the constructor/`this.fps` detail this refactor also fixed.
 *
 * Scrub-preview (mallory-graph#9): the full render (`runSurfaceExportJob`)
 * and the single-frame preview (`renderSurfacePreviewFrame`) both drive the
 * exact same `SurfaceExportScene` class -- one scene so the preview can
 * never drift from what the real export produces. `renderStill`'s own doc
 * comment (ecmanim/src/node.ts) confirms it accepts a Scene subclass
 * directly, same as `render()`, not just a bare construct function.
 */
import { createServerFn } from "@tanstack/react-start";
import { renderStill } from "ecmanim/node";
import { completeExportJob, createExportJob, failExportJob, type ExportVideoResult } from "./export-jobs.ts";
import { renderExportToBuffer } from "./export-render.ts";
import { SurfaceExportScene, type SurfaceSceneParams } from "./scenes/surface-scene.ts";

export type SurfaceExportInput = SurfaceSceneParams & { format: "mp4" | "gif" };

/** Path `renderParallel`'s workers `import()` the scene from, resolved
 *  relative to `process.cwd()` -- see export-render.ts's doc comment. */
const SCENE_MODULE_PATH = "src/lib/scenes/surface-scene.ts";
const SCENE_EXPORT_NAME = "SurfaceExportScene";

async function runSurfaceExportJob(jobId: string, data: SurfaceExportInput) {
  try {
    const { format, ...params } = data;
    completeExportJob(jobId, await renderExportToBuffer(SCENE_MODULE_PATH, SCENE_EXPORT_NAME, params, format));
  } catch (e) {
    failExportJob(jobId, e);
  }
}

/**
 * One PNG frame of the surface export at `time` seconds, for a scrub
 * preview -- mirrors export-video.ts's `renderExportPreviewFrame`
 * (mallory-graph#9). Rendered at half the export's resolution (320x320 vs
 * 640x640) since it's a transient UI aid, not the deliverable.
 */
export const renderSurfacePreviewFrame = createServerFn({ method: "POST" })
  .validator((data: SurfaceExportInput & { time: number }) => data)
  .handler(async ({ data }): Promise<ExportVideoResult> => {
    const { format: _format, time, ...params } = data;

    const { promises: fs } = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mallory-graph-surface-preview-"));
    const outPath = path.join(dir, "preview.png");
    try {
      // A single frame is fast enough as a plain in-process call -- no need
      // for renderParallel's worker sharding here, so this calls the shared
      // SurfaceExportScene class directly, same as before #210 just via
      // `params` instead of a closure.
      await renderStill(SurfaceExportScene, {
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

export const startSurfaceExportJob = createServerFn({ method: "POST" })
  .validator((data: SurfaceExportInput) => data)
  .handler(async ({ data }) => {
    if (!(data.duration > 0)) throw new Error("Export duration must be positive.");
    const jobId = createExportJob();
    // Not awaited: renders in the background; the client polls via
    // export-video.ts's getExportVideoJob (one shared store/poll endpoint).
    void runSurfaceExportJob(jobId, data);
    return { jobId };
  });
