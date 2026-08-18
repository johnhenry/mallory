/**
 * Statically-importable ecmanim scene for the 2D expression video export
 * (`export-video.ts`) -- johnhenry/mallory-graph#210.
 *
 * ecmanim's `renderParallel` shards a scene's play()/wait() segments across
 * worker_threads: each worker independently `import()`s the scene by file
 * path + export name (it cannot be handed an in-memory closure the way the
 * old single-threaded `render(construct, ...)` call could -- see
 * `ecmanim/src/node-parallel.ts`'s own header comment). That means the
 * construct script has to live in its own module and read every bit of
 * per-request data from ecmanim's `params` argument instead of closing over
 * already-bound values -- this file used to be `buildConstruct(data, roots)`
 * inside export-video.ts, a closure built fresh per HTTP request.
 *
 * `params` here is exactly `renderParallel`'s (and `render`'s/`renderStill`'s)
 * `options.params`, threaded through unchanged to the main-thread discovery
 * pass, every worker, and the final concat step -- so it has to be
 * deterministic: node-parallel.ts's "DETERMINISM REQUIREMENT" doc comment is
 * explicit that unseeded `Math.random()`/`Date.now()` would desync the
 * content-addressed partial-segment cache between workers. Nothing here uses
 * either.
 *
 * Root crossings (the Flash prelude) are recomputed here from `params`
 * rather than passed in as a separate value (the old code computed them once
 * in `runExportJob` and closed over the result) -- for the same determinism
 * reason: a second, independently-supplied input is one more thing that
 * would have to be kept in sync across workers instead of falling out of
 * `params` alone.
 */
import { Axes, alwaysRedraw, Flash, initMathTex, MathTex, rate_functions, Transform, ValueTracker } from "ecmanim/node";
import { Symbolic } from "mallory-math";
import { AXIS_COLOR, CURVE_COLOR, LABEL_COLOR, SQUARE_HALF_SPAN } from "../export-render.ts";
import { preprocessImplicitMultiplication } from "../implicit-mult.ts";
import { findRootCrossings, sampleExpr } from "../sample-function.ts";
import { HIGHLIGHT_PRELUDE_SECONDS, interpolateKeyframes, type Keyframe } from "../timeline.ts";

export interface Expression2DSceneParams {
  source: string;
  /** Current value of every free variable (used as-is for the ones with no track). */
  params: Record<string, number>;
  /** Keyframe track per free variable; absent/undefined means "held at params[name]". */
  tracks: Record<string, Keyframe[] | undefined>;
  viewport: { xMin: number; xMax: number; yMin: number; yMax: number };
  duration: number;
  /** Typeset equation label (LaTeX source, client-generated via exprToLatex). Absent/invalid just omits the label. */
  latex?: string;
}

// Per-worker singleton (each worker_threads instance gets its own module
// registry, so this is at most one MathJax warmup per worker, matching the
// old per-process singleton's intent).
let mathTexReady: Promise<unknown> | null = null;

/**
 * Root crossings of the curve in its initial (t=0) state -- the points the
 * Flash prelude highlights. Computed fresh from `params` (see this file's
 * header comment): the single-pane GraphCanvas that drives this export has
 * no roots cell of its own to pass along (that's a /multi feature), and
 * re-deriving here keeps the scene self-contained and deterministic.
 * Sampling failure (mid-typing garbage) just means no highlights.
 */
function initialRootCrossings(data: Expression2DSceneParams): { x: number; y: number }[] {
  try {
    const env: Record<string, number> = { ...data.params };
    for (const [name, track] of Object.entries(data.tracks)) {
      if (track) env[name] = interpolateKeyframes(track, 0);
    }
    const path = sampleExpr(
      data.source,
      { min: data.viewport.xMin, max: data.viewport.xMax },
      400,
      "x",
      env,
      undefined,
      { min: data.viewport.yMin, max: data.viewport.yMax },
    );
    return findRootCrossings(path);
  } catch {
    return [];
  }
}

/**
 * The scene script, shared by the full parallel/sequential export and the
 * single-frame scrub preview (`renderExportPreviewFrame` in
 * export-video.ts, which calls this directly in-process via `renderStill`
 * rather than through `renderParallel` -- a single frame is already fast
 * enough as a plain request/response, no worker sharding needed).
 */
export async function construct(scene: any, data: Expression2DSceneParams): Promise<void> {
  const { source, params, tracks, viewport, duration } = data;
  const compiled = Symbolic.compile(preprocessImplicitMultiplication(source));
  const roots = initialRootCrossings(data);

  // Explicit lengths are load-bearing on ecmanim 0.2.0+: without them, an
  // axis is sized ~one scene unit per data unit, so this app's default
  // asymmetric yRange (-10..100 = 110 units) ran the axes -- and the curve
  // plotted against them -- almost entirely off-frame, rendering blank
  // clips (caught when the 0.0.11 -> 0.2.0 upgrade was verified against
  // the real viewport, not just a small symmetric scratch range).
  const axes = new Axes({
    xRange: [viewport.xMin, viewport.xMax, (viewport.xMax - viewport.xMin) / 10],
    yRange: [viewport.yMin, viewport.yMax, (viewport.yMax - viewport.yMin) / 10],
    xLength: 7,
    yLength: 6.4,
    axisConfig: { color: AXIS_COLOR },
    // fontSize shrunk from ecmanim's 0.35 default -- at this export's
    // SQUARE_HALF_SPAN=4 world-unit half-frame over a 640x640 render
    // (~80px/unit), 0.35 crowds against the default 11-label-per-axis
    // tick step above. color left unset so it inherits AXIS_COLOR from
    // axisConfig (Axes merges axisConfig before xAxisConfig/yAxisConfig).
    xAxisConfig: { includeNumbers: true, fontSize: 0.24 },
    yAxisConfig: { includeNumbers: true, fontSize: 0.24 },
  });
  const elapsedTracker = new ValueTracker(0);

  const curve = alwaysRedraw(() =>
    axes.plot(
      (x: number) => {
        const elapsed = elapsedTracker.getValue();
        const env: Record<string, number> = { ...params, x };
        for (const [name, track] of Object.entries(tracks)) {
          if (track) env[name] = interpolateKeyframes(track, elapsed);
        }
        return compiled(env);
      },
      { xRange: [viewport.xMin, viewport.xMax], color: CURVE_COLOR },
    ),
  );

  // Not scene.add()'d: a ValueTracker has no visible geometry of its own
  // (manim's convention too) -- it only needs to be handed to play() to
  // drive its own interpolation, which alwaysRedraw's curve then reads.
  scene.add(axes, curve);

  if (data.latex) {
    try {
      mathTexReady ??= initMathTex();
      await mathTexReady;
      const label = new MathTex(`y = ${data.latex}`, { color: LABEL_COLOR });
      // The render is square, so toCorner(UL) (which positions against the
      // full 16:9-ish frame) would land outside the visible crop --
      // top-center inside the square-safe zone instead, scaled to fit.
      const maxWidth = SQUARE_HALF_SPAN * 2 - 1;
      if (label.getWidth() > maxWidth) label.scale(maxWidth / label.getWidth());
      label.moveTo([0, SQUARE_HALF_SPAN - 0.6, 0]);
      scene.add(label);
    } catch {
      // Bad/unrenderable latex -- the label is a nicety, never fail the export for it.
    }
  }

  if (roots.length > 0) {
    const flashes = roots.map((r) => new Flash(axes.c2p(r.x, r.y)));
    await scene.play(...flashes, { runTime: HIGHLIGHT_PRELUDE_SECONDS });
  }

  const target = elapsedTracker.copy();
  target.setValue(duration);
  const advanceTime = new Transform(elapsedTracker, target, { rateFunc: rate_functions.linear });
  await scene.play(advanceTime, { runTime: duration });
}
