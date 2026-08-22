/**
 * Statically-importable ecmanim scene for MlPlaygroundPanel's decision-
 * boundary video export (`export-ml-video.ts`) -- johnhenry/mallory#337.
 * A bare top-level `construct(scene, params)` function, matching
 * `ode-scene.ts`'s/`ca-scene.ts`'s `construct2d`'s shape (flat 2D, no
 * camera/depth-sorting machinery needed).
 *
 * Unlike every other panel in this issue's video-export series (CA, graph
 * theory, gradient descent, tiles), MlPlaygroundPanel's on-page "animation"
 * isn't a precomputed, deterministic array sitting in a cell ready to
 * replay via TransportControls -- it's a LIVE, imperative training loop
 * (`handleTrain` in the panel calls `trainModel` with a per-epoch `onEpoch`
 * callback, mutating the model's weights and redrawing as it goes). But
 * `trainModel` IS itself deterministic given the same seeded model + points
 * + hyperparameters (see ml-playground.ts's own doc comments), so this scene
 * recomputes the SAME training run from scratch server-side -- building a
 * fresh `TinyMlp` from `params.hidden/modelSeed/dropout/numClasses` and
 * calling `trainModel` with an `onEpoch` hook that snapshots the decision
 * boundary at each captured epoch (`predictProbabilityGrid`/
 * `predictClassGrid`, the exact functions the panel itself calls once
 * AFTER training completes -- here called incrementally, DURING training)
 * -- rather than accepting a precomputed snapshot array as a param. Same
 * "recompute, don't trust a precomputed value" reasoning `ca-scene.ts`'s own
 * doc comment gives.
 *
 * The one deliberate exception: `params.points` IS passed in precomputed
 * (not regenerated from a dataset type + seed) -- see `MlSceneParams.points`
 * below for why that's the correct call here, not a shortcut.
 *
 * Once the full `snapshots` array is built, it's spread evenly across the
 * export's `duration` -- the same "reparametrize the full history across
 * duration" approach `ca-scene.ts`'s `construct2d` uses for its generation
 * spacetime, just applied to training epochs instead of CA generations.
 */
import { Dot, Square, VGroup } from "ecmanim/node";
import { SQUARE_HALF_SPAN } from "../export-render.ts";
import {
  TinyMlp,
  predictClassGrid,
  predictProbabilityGrid,
  trainModel,
  type LabeledPoint,
} from "../ml-playground.ts";

/**
 * Must match MlPlaygroundPanel.tsx's own module-level `DOMAIN`/
 * `GRID_RESOLUTION` consts exactly for `min`/`max` (not exported from the
 * panel, so duplicated here -- `RESOLUTION` is deliberately NOT the panel's
 * 80: see `EXPORT_GRID_RESOLUTION` below).
 */
const DOMAIN = { min: -4, max: 4 };

/**
 * Scope-narrowing choice: the on-page boundary renders at `GRID_RESOLUTION`
 * = 80 (6400 cells) painted as a single `putImageData` call, which is cheap
 * on a canvas. Here every cell is its own `Square` mobject (there's no
 * ecmanim heatmap/image primitive that takes a raw pixel buffer the way
 * `CanvasRenderingContext2D.putImageData` does), so 6400 persistent mobjects
 * -- each recolored every rendered frame -- is a much heavier ask than CA's
 * own 6400-mobject grid (which only ever toggles opacity, never recolors,
 * and CA's own doc comment already flags that count as the top of this
 * pattern's comfortable range). 40x40 = 1600 squares keeps the boundary
 * legible (a 40x40 heatmap still clearly shows XOR/moons/rings-shaped
 * regions) while quartering both the mobject count and the per-frame
 * recolor cost relative to the on-page resolution.
 */
const EXPORT_GRID_RESOLUTION = 40;

/**
 * Scope-narrowing choice: `ml-playground.ts`'s own `MAX_EPOCHS` is 2000, and
 * every captured epoch costs one extra `predictProbabilityGrid`/
 * `predictClassGrid` forward pass (batched over `EXPORT_GRID_RESOLUTION^2`
 * grid cells) plus one more slice of the `snapshots` array to hold in
 * memory. 2000 snapshots would very likely still finish, but there's no
 * reason to pay for temporal resolution finer than the rendered clip can
 * even show: at 24fps a typical few-second export shows well under 200
 * distinct frames total, so capturing more than ~200 epoch snapshots buys
 * nothing visible. `captureStride` below spaces snapshots out so the total
 * count never exceeds this regardless of how many epochs were requested,
 * same "simple fixed stride, not adaptive" convention this issue's other
 * PRs used for their own scope-narrowing.
 */
const MAX_SNAPSHOTS = 200;

/**
 * Issue #253's multi-class categorical palette, duplicated from
 * MlPlaygroundPanel.tsx's own (unexported) `CLASS_COLORS` -- kept in sync by
 * hand; both arrays are small and rarely touched. Index 0/1 are the
 * original binary blue/red.
 */
const CLASS_COLORS: readonly [number, number, number][] = [
  [29, 78, 216], // blue
  [185, 28, 28], // red
  [21, 128, 61], // green
  [161, 98, 7], // amber
  [126, 34, 206], // purple
  [15, 118, 110], // teal
  [194, 65, 12], // orange
  [67, 56, 202], // indigo
];

function classColorHex(cls: number): string {
  const [r, g, b] = CLASS_COLORS[cls % CLASS_COLORS.length]!;
  return `rgb(${r}, ${g}, ${b})`;
}

/** Duplicated from MlPlaygroundPanel.tsx's own `classBackgroundColor` -- the multi-class boundary's pale-tint background regions. */
function classBackgroundColorHex(cls: number, amount = 0.75): string {
  const [r, g, b] = CLASS_COLORS[cls % CLASS_COLORS.length]!;
  const rr = Math.round(r + (255 - r) * amount);
  const gg = Math.round(g + (255 - g) * amount);
  const bb = Math.round(b + (255 - b) * amount);
  return `rgb(${rr}, ${gg}, ${bb})`;
}

/** Duplicated from MlPlaygroundPanel.tsx's own `probabilityColor` -- blue (P~0) through white (P=0.5) to red (P~1), mapped absolutely over [0,1]. */
function probabilityColorHex(p: number): string {
  const t = Math.max(0, Math.min(1, p));
  if (t < 0.5) {
    const u = t / 0.5;
    return `rgb(${Math.round(96 + u * 159)}, ${Math.round(148 + u * 107)}, 255)`;
  }
  const u = (t - 0.5) / 0.5;
  return `rgb(255, ${Math.round(255 - u * 155)}, ${Math.round(255 - u * 159)})`;
}

interface BoundarySnapshot {
  kind: "probability" | "class";
  grid: number[][];
}

export interface MlSceneParams {
  /**
   * The CURRENT dataset's already-resolved points, passed through as-is
   * rather than regenerated server-side from a dataset type + seed --
   * unlike CA/graph-theory/etc, which recompute their whole simulation from
   * a seed alone, MlPlaygroundPanel's "drawn" dataset can contain
   * hand-clicked points with no seed to reconstruct them from at all, and
   * "csv" points come from an arbitrary import. The array itself is always
   * small (bounded by the same UI that produced it), so serializing it
   * directly is the correct choice here, not a shortcut -- `trainModel`
   * itself is still recomputed from scratch against these points, same as
   * every other export in this series.
   */
  points: LabeledPoint[];
  hidden: number;
  modelSeed: number;
  dropout: number;
  numClasses: number;
  lr: number;
  epochs: number;
  schedule?: { stepSize: number; gamma: number };
  duration: number;
}

export async function construct(scene: any, data: MlSceneParams): Promise<void> {
  const model = new TinyMlp(data.hidden, data.modelSeed, data.dropout, data.numClasses);

  function captureSnapshot(): BoundarySnapshot {
    return model.numClasses === 2
      ? { kind: "probability", grid: predictProbabilityGrid(model, DOMAIN, EXPORT_GRID_RESOLUTION) }
      : { kind: "class", grid: predictClassGrid(model, DOMAIN, EXPORT_GRID_RESOLUTION) };
  }

  const captureStride = Math.max(1, Math.ceil(data.epochs / MAX_SNAPSHOTS));
  // The untrained model's own decision boundary (epoch "-1") is the clip's
  // first frame, so the export starts from the same blank state the panel
  // shows before any Train click, not already mid-progress.
  const snapshots: BoundarySnapshot[] = [captureSnapshot()];
  await trainModel(model, data.points, data.lr, data.epochs, data.schedule, ({ epoch }) => {
    const isLastEpoch = epoch === data.epochs - 1;
    if ((epoch + 1) % captureStride === 0 || isLastEpoch) snapshots.push(captureSnapshot());
  });

  const domainSpan = DOMAIN.max - DOMAIN.min;
  const sceneSpan = 2 * SQUARE_HALF_SPAN;
  // Maps a domain coordinate onto scene space -- domainSpan and sceneSpan
  // are both exactly 8 for this panel's DOMAIN (-4..4) and ecmanim's own
  // SQUARE_HALF_SPAN (4), so this is a 1:1 mapping in practice, but written
  // as an explicit scale rather than assumed so it stays correct if either
  // constant ever changes independently.
  const toScene = (d: number) => ((d - DOMAIN.min) / domainSpan) * sceneSpan - SQUARE_HALF_SPAN;
  const cellSpan = (domainSpan / EXPORT_GRID_RESOLUTION) * (sceneSpan / domainSpan);

  const boundaryGroup = new VGroup();
  // squares[row][col], row 0 at DOMAIN.min y -- matching predictProbabilityGrid/
  // predictClassGrid's own grid layout (gridInput's doc comment: "row 0 at
  // domain.min y"). Scene space has +y up, so row 0 (domain MIN y) belongs
  // at the BOTTOM of the scene -- no flip needed here, unlike the on-page
  // canvas's drawMlBoundaryPanel, which flips because canvas y grows
  // downward.
  const squares: Square[][] = [];
  for (let row = 0; row < EXPORT_GRID_RESOLUTION; row++) {
    const rowSquares: Square[] = [];
    for (let col = 0; col < EXPORT_GRID_RESOLUTION; col++) {
      const square = new Square({
        sideLength: cellSpan,
        fillColor: "#ffffff",
        fillOpacity: 1,
        strokeWidth: 0,
      });
      const x = toScene(DOMAIN.min + (col + 0.5) * (domainSpan / EXPORT_GRID_RESOLUTION));
      const y = toScene(DOMAIN.min + (row + 0.5) * (domainSpan / EXPORT_GRID_RESOLUTION));
      square.moveTo([x, y, 0]);
      boundaryGroup.add(square);
      rowSquares.push(square);
    }
    squares.push(rowSquares);
  }
  scene.add(boundaryGroup);

  function paintSnapshot(snapshot: BoundarySnapshot) {
    for (let row = 0; row < EXPORT_GRID_RESOLUTION; row++) {
      for (let col = 0; col < EXPORT_GRID_RESOLUTION; col++) {
        const cell = snapshot.grid[row]![col]!;
        const color = snapshot.kind === "probability" ? probabilityColorHex(cell) : classBackgroundColorHex(cell);
        squares[row]![col]!.setFill(color, 1);
      }
    }
  }
  paintSnapshot(snapshots[0]!);

  let elapsed = 0;
  let lastIndex = 0;
  boundaryGroup.addUpdater(
    (_m: unknown, dt: number) => {
      elapsed += dt;
      const index = Math.min(snapshots.length - 1, Math.floor((elapsed / data.duration) * snapshots.length));
      if (index === lastIndex) return;
      lastIndex = index;
      paintSnapshot(snapshots[index]!);
    },
    { hashExtra: () => String(elapsed) },
  );

  // The labeled-point scatter, drawn on top of the boundary heatmap -- same
  // layering as drawMlBoundaryPanel's own draw order. Static: the points
  // themselves never change across the clip, unlike the boundary above, so
  // these are added once with no updater.
  const pointsGroup = new VGroup();
  for (const p of data.points) {
    pointsGroup.add(
      new Dot({
        point: [toScene(p.x), toScene(p.y), 0],
        radius: 0.07,
        fillColor: classColorHex(p.label),
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWidth: 1,
      }),
    );
  }
  scene.add(pointsGroup);

  await scene.wait(data.duration);
}
