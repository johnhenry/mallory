/**
 * Statically-importable ecmanim scene for TilesPanel's main Wang-tile solve
 * animation video export (`export-tiles-video.ts`) -- johnhenry/mallory-graph#337.
 * Only the primary square/Wang lattice's `solveSteps` animation is exported
 * -- the hex/tri/cube lattices and the entropy/diffraction/relax
 * sub-features are all static-only (no `TransportControls`), same
 * "only the animated view" scoping `ca-scene.ts`/`graph-theory-scene.ts`
 * use. `solver: "sat"` produces no steps at all (see tile-model.ts's
 * `solveWangViaSat` doc comment) -- exporting that case yields `duration
 * <= 0`, which `export-tiles-video.ts`'s job starter already rejects, same
 * as the panel's own "nothing to animate" handling.
 *
 * Must be a top-level export and deterministic given `params` -- see
 * `ode-scene.ts`'s doc comment for why (worker_threads re-`import()` by
 * path + export name, segment-cache correctness).
 *
 * Recomputes the tile set and the solve-step sequence via the exact same
 * functions the panel calls (`parseTileSetText`, `expandTileSetSymmetry`,
 * `solveWang`/`solveTorus`, draining the async generator the same way the
 * panel's own `drainSolve` does) -- no solver logic is reimplemented here.
 *
 * Each `SolveStep` already carries a FULL grid snapshot (`tile-model.ts`'s
 * own doc comment on `SolveStep.grid`), unlike `ca-scene.ts`'s per-
 * generation opacity toggle or `graph-theory-scene.ts`'s per-vertex/edge
 * color toggle -- a placement or backtrack can change a cell's entire tile
 * identity (fill color, id label text, 4 edge-label colors), and `Text`
 * mobjects can't have their string content mutated in place. So instead of
 * toggling style fields on persistent mobjects, this scene rebuilds the
 * grid's mobjects from scratch on every DISTINCT sampled step index (via a
 * single group-level updater, same elapsed-accumulator idiom as the other
 * two scenes) -- cheap enough given the grid is capped at
 * `TilesPanel.tsx`'s own `MAX_CELLS` and the number of distinct steps
 * actually sampled is bounded by `duration * fps`, not by the solve's own
 * (possibly much larger) total step count.
 */
import { Line, Rectangle, Square, Text, VGroup } from "ecmanim/node";
import { SQUARE_HALF_SPAN } from "../export-render.ts";
import { edgeLabelColor } from "../tiles/edge-colors.ts";
import { expandTileSetSymmetry, type SymmetryGroup } from "../tiles/symmetry.ts";
import { solveTorus, solveWang, type SolveStep, type Tile, type TileSet } from "../tiles/tile-model.ts";
import { parseTileSetText } from "../tile-set-text.ts";

const EMPTY_CELL_FILL = "#e5e7eb";
const CONTRADICTION_COLOR = "#dc2626";
const PLACEMENT_COLOR = "#16a34a";
const LABEL_TEXT_COLOR = "#ffffff";

export interface TilesSceneParams {
  tilesText: string;
  width: number;
  height: number;
  symmetry: SymmetryGroup;
  solver: "wang" | "torus";
  duration: number;
}

async function drainSteps(gen: AsyncGenerator<SolveStep, unknown>): Promise<SolveStep[]> {
  const steps: SolveStep[] = [];
  let next = await gen.next();
  while (!next.done) {
    steps.push(next.value);
    next = await gen.next();
  }
  return steps;
}

export async function construct(scene: any, data: TilesSceneParams): Promise<void> {
  const baseTileSet: TileSet = parseTileSetText(data.tilesText);
  const tileSet = expandTileSetSymmetry(baseTileSet, data.symmetry);
  const tileMap = new Map(tileSet.tiles.map((t) => [t.id, t]));
  const gen = data.solver === "torus" ? solveTorus(tileSet, data.width, data.height, { trackSteps: true }) : solveWang(tileSet, data.width, data.height, { trackSteps: true });
  const steps = await drainSteps(gen);

  const cellSpan = (2 * SQUARE_HALF_SPAN) / Math.max(data.width, data.height);
  const cellSize = cellSpan * 0.92;
  const scenePoint = (row: number, col: number): [number, number] => [(col - (data.width - 1) / 2) * cellSpan, ((data.height - 1) / 2 - row) * cellSpan];

  const buildEdge = (row: number, col: number, tile: Tile | undefined): void => {
    if (!tile) return;
    const [cx, cy] = scenePoint(row, col);
    const half = cellSize / 2;
    const corners: Record<"n" | "e" | "s" | "w", [number, number]> = {
      n: [cx - half, cy + half],
      e: [cx + half, cy + half],
      s: [cx + half, cy - half],
      w: [cx - half, cy - half],
    };
    const edges: Array<[[number, number], [number, number], string]> = [
      [corners.n, corners.e, tile.edges.N],
      [corners.e, corners.s, tile.edges.E],
      [corners.w, corners.s, tile.edges.S],
      [corners.n, corners.w, tile.edges.W],
    ];
    for (const [a, b, label] of edges) {
      gridGroup.add(new Line([a[0], a[1], 0], [b[0], b[1], 0], { strokeColor: edgeLabelColor(label), strokeWidth: 3 }));
    }
  };

  const gridGroup = new VGroup();
  scene.add(gridGroup);

  let elapsed = 0;
  let lastStepIndex = -2;
  gridGroup.addUpdater(
    (_m: unknown, dt: number) => {
      elapsed += dt;
      const stepIndex = steps.length > 0 ? Math.min(steps.length - 1, Math.floor((elapsed / data.duration) * steps.length)) : -1;
      if (stepIndex === lastStepIndex) return;
      lastStepIndex = stepIndex;
      gridGroup.remove([...gridGroup.submobjects]);

      const step = stepIndex >= 0 ? steps[stepIndex] : undefined;
      const displayGrid = step?.grid ?? null;
      if (!displayGrid) return;

      for (let row = 0; row < displayGrid.length; row++) {
        const gridRow = displayGrid[row]!;
        for (let col = 0; col < gridRow.length; col++) {
          const id = gridRow[col];
          const [cx, cy] = scenePoint(row, col);
          const tile = id ? tileMap.get(id) : undefined;
          const square = new Square({ sideLength: cellSize, fillColor: id ? tileColor(id) : EMPTY_CELL_FILL, fillOpacity: 1, strokeWidth: 0 });
          square.moveTo([cx, cy, 0]);
          gridGroup.add(square);
          buildEdge(row, col, tile);
          if (id) {
            const label = new Text(id, { fontSize: cellSize * 0.4, color: LABEL_TEXT_COLOR });
            label.moveTo([cx, cy, 0]);
            gridGroup.add(label);
          }
        }
      }

      if (step) {
        const [cx, cy] = scenePoint(step.row, step.col);
        const highlight = new Rectangle({
          width: cellSize,
          height: cellSize,
          strokeColor: step.contradiction ? CONTRADICTION_COLOR : PLACEMENT_COLOR,
          strokeWidth: 5,
          fillOpacity: 0,
        });
        highlight.moveTo([cx, cy, 0]);
        gridGroup.add(highlight);
      }
    },
    { hashExtra: () => String(elapsed) },
  );

  await scene.wait(data.duration);
}

/** Same hash-based id -> hue mapping as TilesPanel.tsx's own `tileColor`. */
function tileColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return `hsl(${hue}, 55%, 55%)`;
}
