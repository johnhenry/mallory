/**
 * Statically-importable ecmanim scene for the z = f(x, y) surface video
 * export (`export-surface-video.ts`) -- johnhenry/mallory#210. See
 * `expression-2d-scene.ts`'s header comment for why this had to move out of
 * an in-request closure (`buildSurfaceScene`, which built a fresh anonymous
 * `class SurfaceExportScene extends ThreeDScene` per HTTP request) and into
 * a single top-level exported class that reads everything from `this.params`
 * instead: `renderParallel`'s worker_threads re-`import()` the scene by file
 * path + export name, so the class itself has to be the same module-level
 * export every time, and the per-segment partial cache requires
 * `construct()` to be deterministic given the same params.
 *
 * `this.params` is populated by ecmanim's Scene constructor from
 * `config.params` (`render()`/`renderStill()`/`renderParallel()` all thread
 * `options.params` through to `new SurfaceExportScene({ fps, camera, params
 * })`) -- which only works if the constructor actually forwards `config` to
 * `super(config)`. The *old* per-request class's `constructor() { super();
 * ... }` took no config at all (it didn't need `this.params`, since the
 * closure already had `data` in scope) -- forwarding `config` here is a
 * required part of this refactor, not a style choice, and it also happens to
 * fix a latent bug: `Scene`'s frame-count math (`Math.round(duration *
 * this.fps)`) previously always saw the `Scene` default of `this.fps = 30`
 * for this export (since the old constructor discarded the `{ fps: 24, ...
 * }` config `render()` builds), so any orbit clip was actually encoded ~1.25x
 * longer than its requested duration once ffmpeg's 24fps encode caught up.
 * Verified by diffing `ffprobe`-reported duration against `data.duration`
 * before/after this change.
 *
 * The class still always installs its OWN `ThreeDCamera` (specific
 * phi/theta/zoom orientation) after `super(config)`, ignoring any
 * `config.camera` the caller passed -- unchanged from the pre-#210
 * behavior and still the documented, idiomatic ecmanim 0.5.0+ pattern (see
 * `export-render.ts`'s doc comment on the camera-swap fix `node.ts`'s
 * `render()` relies on). `renderParallel`'s own worker path
 * (`node-parallel.ts`'s `buildScene`) has no equivalent swap-detection
 * rebind, but that gap never bites here in practice: this scene's whole
 * animation is a single `wait()` call (see `construct()` below), so
 * `renderParallel`'s own segment-count fallback (`segmentCount < 2 *
 * workers`) always routes this export back through the sequential `render()`
 * path anyway -- confirmed empirically, see this repo's
 * `export-surface-video.test.ts`.
 */
import { Surface, ThreeDAxes, ThreeDCamera, ThreeDScene } from "ecmanim/node";
import { Symbolic } from "@johnhenry/math";
import { preprocessImplicitMultiplication } from "../implicit-mult.ts";
import { interpolateKeyframes, type Keyframe } from "../timeline.ts";

const SURFACE_COLORS = ["#3b82f6", "#60a5fa"];
const SURFACE_RESOLUTION = 28;
/**
 * Resolution used on the animated path (`Surface.setFunc` rebuilds the whole
 * face mesh every frame, unlike the static/orbit-only path which builds
 * once). Measured directly (one animated var, duration=4s, 24fps -> 120
 * setFunc calls) against a same-duration static-orbit export before picking
 * this: at resolution 28, the animated export's total wall-clock was ~1.5x
 * the static one's (setFunc itself averaged ~13ms/call, ~1.5s of the clip's
 * ~11s total render time) -- comfortably inside the ~2-3x acceptance
 * ceiling, so the animated path keeps the same resolution as the static one
 * rather than trading visual fidelity for speed it doesn't need. (A
 * candidate resolution=18 measured ~1.1x -- faster, but not needed to clear
 * the bar.)
 */
const ANIMATED_SURFACE_RESOLUTION = SURFACE_RESOLUTION;

export interface SurfaceSceneParams {
  source: string;
  /** Current value of every free variable (used as-is for the ones with no track). */
  params: Record<string, number>;
  /** Keyframe track per free variable; absent/undefined means "held at params[name]". */
  tracks: Record<string, Keyframe[] | undefined>;
  xDomain: { min: number; max: number };
  yDomain: { min: number; max: number };
  duration: number;
}

/**
 * Common padding/fallback logic for a sampled [zMin, zMax] extent -- shared
 * by the static (`surfaceZRange`) and animated (`animatedSurfaceZRange`)
 * samplers below. Non-finite input (nothing finite sampled at all) falls
 * back to a symmetric unit-ish range so the axes still have extent; a
 * degenerate/flat result gets a +/-1 pad instead of a zero-width axis.
 */
function padZExtent(zMin: number, zMax: number): [number, number] {
  if (!Number.isFinite(zMin) || !Number.isFinite(zMax)) return [-1, 1];
  if (zMax - zMin < 1e-9) return [zMin - 1, zMax + 1];
  const pad = (zMax - zMin) * 0.1;
  return [zMin - pad, zMax + pad];
}

/** Coarse [zMin, zMax] sample of `f` over the export's x/y domain, skipping non-finite samples (poles, domain holes). */
function sampleZExtent(f: (x: number, y: number) => number, input: SurfaceSceneParams): [number, number] {
  let zMin = Number.POSITIVE_INFINITY;
  let zMax = Number.NEGATIVE_INFINITY;
  const N = 24;
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const x = input.xDomain.min + (i / N) * (input.xDomain.max - input.xDomain.min);
      const y = input.yDomain.min + (j / N) * (input.yDomain.max - input.yDomain.min);
      const z = f(x, y);
      if (!Number.isFinite(z)) continue;
      if (z < zMin) zMin = z;
      if (z > zMax) zMax = z;
    }
  }
  return [zMin, zMax];
}

/**
 * z-range for the axes, from a coarse sample of the surface itself --
 * hardcoding a range would clip a tall surface and dwarf a flat one.
 */
function surfaceZRange(f: (x: number, y: number) => number, input: SurfaceSceneParams): [number, number] {
  const [zMin, zMax] = sampleZExtent(f, input);
  return padZExtent(zMin, zMax);
}

/**
 * Like `surfaceZRange`, but for an animated surface: samples at t=0, t=duration,
 * and every keyframe time (deduped, clamped to [0, duration]) across every
 * track, then unions the extents -- so the fixed z-axis comfortably bounds
 * the whole clip instead of just the initial frame.
 */
function animatedSurfaceZRange(zAt: (t: number, x: number, y: number) => number, input: SurfaceSceneParams): [number, number] {
  const times = new Set<number>([0, input.duration]);
  for (const track of Object.values(input.tracks)) {
    if (!track) continue;
    for (const k of track) {
      if (k.t >= 0 && k.t <= input.duration) times.add(k.t);
    }
  }
  let zMin = Number.POSITIVE_INFINITY;
  let zMax = Number.NEGATIVE_INFINITY;
  for (const t of times) {
    const [tMin, tMax] = sampleZExtent((x, y) => zAt(t, x, y), input);
    if (tMin < zMin) zMin = tMin;
    if (tMax > zMax) zMax = tMax;
  }
  return padZExtent(zMin, zMax);
}

export class SurfaceExportScene extends ThreeDScene {
  constructor(config: any = {}) {
    super(config);
    this.camera = new ThreeDCamera({
      phi: (65 * Math.PI) / 180,
      theta: (-45 * Math.PI) / 180,
      zoom: 0.75,
      background: "#ffffff",
    });
  }

  override async construct(): Promise<void> {
    const data = this.params as SurfaceSceneParams;
    const compiled = Symbolic.compile(preprocessImplicitMultiplication(data.source));
    const hasAnimatedParams = Object.values(data.tracks).some((track) => track != null && track.length > 0);
    const zAt = (t: number, x: number, y: number): number => {
      const env: Record<string, number> = { ...data.params, x, y };
      for (const [name, track] of Object.entries(data.tracks)) {
        if (track) env[name] = interpolateKeyframes(track, t);
      }
      return compiled(env);
    };
    const [zMin, zMax] = hasAnimatedParams
      ? animatedSurfaceZRange(zAt, data)
      : surfaceZRange((x, y) => zAt(0, x, y), data);
    const { xDomain, yDomain, duration } = data;

    const axes = new ThreeDAxes({
      xRange: [xDomain.min, xDomain.max, (xDomain.max - xDomain.min) / 10],
      yRange: [yDomain.min, yDomain.max, (yDomain.max - yDomain.min) / 10],
      zRange: [zMin, zMax, (zMax - zMin) / 4],
      xLength: 6,
      yLength: 6,
      zLength: 3,
    });
    // A pole/hole still has to return *a* point (Surface tessellates a
    // full grid); clamp it to the axes' z extent so one singular cell
    // doesn't stretch the whole tessellation off-frame.
    const surfaceFuncAt = (t: number) => (u: number, v: number) => {
      const z = zAt(t, u, v);
      return axes.c2p(u, v, Number.isFinite(z) ? Math.min(Math.max(z, zMin), zMax) : zMin);
    };
    const surface = new Surface(surfaceFuncAt(0), {
      uRange: [xDomain.min, xDomain.max],
      vRange: [yDomain.min, yDomain.max],
      resolution: hasAnimatedParams ? ANIMATED_SURFACE_RESOLUTION : SURFACE_RESOLUTION,
      checkerboardColors: SURFACE_COLORS,
      fillOpacity: 0.85,
    });
    this.enableDepthSorting(true);
    this.add(axes, surface);
    if (hasAnimatedParams) {
      let elapsed = 0;
      surface.addUpdater(
        (_m: unknown, dt: number) => {
          elapsed += dt;
          surface.setFunc(surfaceFuncAt(elapsed));
        },
        { hashExtra: () => String(elapsed) },
      );
    }
    // One full orbit over the clip: rate is radians/second.
    this.beginAmbientCameraRotation({ rate: (2 * Math.PI) / duration });
    await this.wait(duration);
    this.stopAmbientCameraRotation();
  }
}
