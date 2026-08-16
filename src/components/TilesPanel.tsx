import { useEffect, useRef, useState } from "react";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useModelContextTool } from "../hooks/use-model-context-tool.ts";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsTiles, TIME_CELL, type CellIdsTiles } from "../lib/cell-ids.ts";
import { DEFAULT_TILES_TEXT, parseTileSetText } from "../lib/tile-set-text.ts";
import {
  DEFAULT_TILES_STATE,
  decodeTilesState,
  encodeTilesState,
  type TilesSolverKind,
  type TilesState,
} from "../lib/tiles-state.ts";
import { solveTorus, solveWang, solveWangViaSat, type SolveStep, type TileSet, type WangGrid } from "../lib/tiles/tile-model.ts";
import { useCell } from "../lib/use-cell.ts";
import { useTimelinePlayback } from "../lib/use-timeline-playback.ts";
import { PngExportButton } from "./PngExportButton.tsx";
import { TransportControls } from "./TransportControls.tsx";

type Result<T> = { ok: true; value: T } | { ok: false; message: string };
type SolveStatus = "idle" | "solving" | "done" | "error";

const CELL_SIZE = 56;
// Backtracking search on a toy tile set is effectively instant, but a
// pathological tile set (or a typo'd huge width/height) could still make
// the search exponential -- this caps both the grid area (drives canvas
// size too) and the raw number of generator steps drained, so a bad input
// degrades to a friendly error message instead of hanging the tab.
const MAX_CELLS = 144;
const MAX_STEPS = 200_000;
// 1 solver step (one placement or one backtrack) = this many seconds of the
// shared TIME_CELL clock -- fast enough that even a several-hundred-step
// backtracking search plays back in a few seconds, unlike GraphTheoryPanel's
// coarser 0.6s/step (a whole vertex/edge/layer event there vs. a single
// cell trial here).
const STEP_SECONDS = 0.15;
// A fixed neutral fill for not-yet-placed cells -- like GraphCanvasMulti/
// GeometryPanel/MatrixPanel's own plain Canvas2D panels, the plot surface
// itself isn't theme-adaptive (only text/marker colors read getThemeColors()
// elsewhere in the family); Canvas2D's fillStyle also can't resolve a raw
// `var(--...)` CSS custom property the way a DOM element's style can.
const EMPTY_CELL_FILL = "#e5e7eb";

function seedState(graph: CellGraph, ids: CellIdsTiles, state: TilesState): void {
  graph.set(ids.tilesText, state.tilesText);
  graph.set(ids.width, state.width);
  graph.set(ids.height, state.height);
  graph.set(ids.solver, state.solver);
  graph.set(ids.showAnimation, state.showAnimation);
}

function getCurrentState(graph: CellGraph, ids: CellIdsTiles): TilesState {
  return {
    v: 1,
    tilesText: graph.get<string>(ids.tilesText),
    width: graph.get<number>(ids.width),
    height: graph.get<number>(ids.height),
    solver: graph.get<TilesSolverKind>(ids.solver),
    showAnimation: graph.get<boolean>(ids.showAnimation),
  };
}

function useTilesGraph(cellId: string): CellGraph {
  const ref = useRef<CellGraph | null>(null);
  if (!ref.current) {
    const graph = new CellGraph();
    const ids = cellIdsTiles(cellId);
    const decoded = typeof window !== "undefined" ? decodeTilesState(window.location.hash.slice(1)) : null;
    seedState(graph, ids, decoded ?? DEFAULT_TILES_STATE);
    if (!graph.has(TIME_CELL)) graph.set(TIME_CELL, 0, { auxiliary: true });
    graph.set(ids.solveStatus, "idle" as SolveStatus, { auxiliary: true });
    graph.set(ids.solveSteps, [] as SolveStep[], { auxiliary: true });
    graph.set(ids.solveGrid, null as WangGrid | null, { auxiliary: true });
    graph.set(ids.solveError, "", { auxiliary: true });

    graph.define(ids.tileSetResult, (): Result<TileSet> => {
      try {
        return { ok: true, value: parseTileSetText(graph.get<string>(ids.tilesText)) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    ref.current = graph;
  }
  return ref.current;
}

/** Deterministic tile-id -> fill color, so the same id always renders the same hue across a solve and across reloads. */
export function tileColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return `hsl(${hue}, 55%, 55%)`;
}

/** One-line caption for a solve step, used both under the transport controls and as the aria-live status. */
export function stepLabel(step: SolveStep): string {
  return step.contradiction
    ? `Backtrack at (${step.row}, ${step.col})`
    : `Place tile at (${step.row}, ${step.col})`;
}

async function drainSolve(
  gen: AsyncGenerator<SolveStep, WangGrid | null>,
): Promise<{ steps: SolveStep[]; grid: WangGrid | null }> {
  const steps: SolveStep[] = [];
  let next = await gen.next();
  while (!next.done) {
    steps.push(next.value);
    if (steps.length > MAX_STEPS) throw new Error(`Search exceeded ${MAX_STEPS} steps -- reduce the grid size or tile set.`);
    next = await gen.next();
  }
  return { steps, grid: next.value };
}

/** A Wang tile laboratory: edit a tile set as text, pick a solver variant, and watch the backtracking search play back step by step (issue #92 M1). */
export function TilesPanel({ cellId = "tiles-1" }: { cellId?: string } = {}) {
  const graph = useTilesGraph(cellId);
  useCellGraphTools(`tiles_${cellId}`, graph);
  const ids = cellIdsTiles(cellId);

  const tilesText = useCell<string>(graph, ids.tilesText);
  const tileSetResult = useCell<Result<TileSet>>(graph, ids.tileSetResult);
  const width = useCell<number>(graph, ids.width);
  const height = useCell<number>(graph, ids.height);
  const solver = useCell<TilesSolverKind>(graph, ids.solver);
  const showAnimation = useCell<boolean>(graph, ids.showAnimation);
  const solveStatus = useCell<SolveStatus>(graph, ids.solveStatus);
  const solveSteps = useCell<SolveStep[]>(graph, ids.solveSteps);
  const solveGrid = useCell<WangGrid | null>(graph, ids.solveGrid);
  const solveError = useCell<string>(graph, ids.solveError);
  const time = useCell<number>(graph, TIME_CELL);

  const [textInput, setTextInput] = useState(tilesText);
  useEffect(() => setTextInput(tilesText), [tilesText]);

  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [speed, setSpeed] = useState(1);
  const duration = showAnimation ? solveSteps.length * STEP_SECONDS : 0;
  useTimelinePlayback(graph, playing, loop, speed, duration, setPlaying);

  useModelContextTool({
    name: `tiles_${cellId}_solve`,
    description:
      "Re-run the Wang tile solve with the panel's current tile set, width, height, and solver variant. Returns whether a tiling was found and how many search steps it took. Normally solving is triggered automatically whenever the tile set/width/height/solver changes, so this is mainly useful to force a re-solve after an external set_cell write.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const status = graph.get<SolveStatus>(ids.solveStatus);
      return { status, found: graph.get<WangGrid | null>(ids.solveGrid) !== null, steps: graph.get<SolveStep[]>(ids.solveSteps).length };
    },
  });

  // Auto-solve whenever the parsed tile set, grid size, or solver variant
  // changes. Backtracking search is CPU work, not something a synchronous
  // CellGraph `compute` fn can do here since solveWang/solveTorus are async
  // generators (streamed so a long search stays pausable/animatable) -- so
  // the result is collected imperatively and written back via `graph.set`,
  // the same "derive an array from an already-computed result" shape
  // GraphTheoryPanel's algorithmSteps uses, just triggered from an effect
  // instead of a `define`.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!tileSetResult.ok) {
        graph.set(ids.solveStatus, "idle" satisfies SolveStatus);
        graph.set(ids.solveSteps, []);
        graph.set(ids.solveGrid, null);
        graph.set(ids.solveError, "");
        return;
      }
      if (width < 1 || height < 1 || width * height > MAX_CELLS) {
        graph.set(ids.solveStatus, "error" satisfies SolveStatus);
        graph.set(ids.solveError, `Grid must be at least 1x1 and at most ${MAX_CELLS} cells total.`);
        return;
      }
      graph.set(ids.solveStatus, "solving" satisfies SolveStatus);
      try {
        const gen =
          solver === "torus"
            ? solveTorus(tileSetResult.value, width, height)
            : solveWang(tileSetResult.value, width, height);
        if (solver === "sat") {
          const grid = solveWangViaSat(tileSetResult.value, width, height);
          if (cancelled) return;
          graph.set(ids.solveSteps, []);
          graph.set(ids.solveGrid, grid);
          graph.set(ids.solveError, "");
          graph.set(ids.solveStatus, "done" satisfies SolveStatus);
          return;
        }
        const { steps, grid } = await drainSolve(gen);
        if (cancelled) return;
        graph.set(ids.solveSteps, steps);
        graph.set(ids.solveGrid, grid);
        graph.set(ids.solveError, "");
        graph.set(ids.solveStatus, "done" satisfies SolveStatus);
      } catch (e) {
        if (cancelled) return;
        graph.set(ids.solveStatus, "error" satisfies SolveStatus);
        graph.set(ids.solveError, e instanceof Error ? e.message : String(e));
      }
    }
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, tileSetResult, width, height, solver]);

  // A changed solve restarts the animation from the beginning.
  useEffect(() => {
    graph.set(TIME_CELL, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solveSteps]);

  const currentStepIndex = solveSteps.length > 0 ? Math.min(solveSteps.length - 1, Math.floor(time / STEP_SECONDS)) : -1;
  const currentStep = currentStepIndex >= 0 ? solveSteps[currentStepIndex] : undefined;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasWidth = Math.max(1, width) * CELL_SIZE;
  const canvasHeight = Math.max(1, height) * CELL_SIZE;

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    const displayGrid: ReadonlyArray<ReadonlyArray<string | null>> | null =
      showAnimation && currentStep ? currentStep.grid : solveGrid;
    if (!displayGrid) return;

    for (let row = 0; row < displayGrid.length; row++) {
      for (let col = 0; col < displayGrid[row]!.length; col++) {
        const id = displayGrid[row]![col];
        const x = col * CELL_SIZE;
        const y = row * CELL_SIZE;
        ctx.fillStyle = id ? tileColor(id) : EMPTY_CELL_FILL;
        ctx.strokeStyle = "#00000022";
        ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
        ctx.strokeRect(x, y, CELL_SIZE, CELL_SIZE);
        if (id) {
          ctx.fillStyle = "#fff";
          ctx.font = "13px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(id, x + CELL_SIZE / 2, y + CELL_SIZE / 2);
        }
      }
    }

    if (showAnimation && currentStep) {
      const x = currentStep.col * CELL_SIZE;
      const y = currentStep.row * CELL_SIZE;
      ctx.strokeStyle = currentStep.contradiction ? "#dc2626" : "#16a34a";
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 1.5, y + 1.5, CELL_SIZE - 3, CELL_SIZE - 3);
    }
  }, [canvasWidth, canvasHeight, showAnimation, currentStep, solveGrid]);

  useEffect(() => {
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeTilesState(getCurrentState(graph, ids))}`);
    }
    writeUrl();
    return graph.subscribeAll(writeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  function updateText(value: string) {
    setTextInput(value);
    graph.set(ids.tilesText, value);
  }

  return (
    <div>
      <div style={{ margin: "0.25rem 0" }}>
        <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)" }}>
          Tile set (one per line: <code>id N E S W</code>)
        </label>
        <textarea
          value={textInput}
          onChange={(e) => updateText(e.target.value)}
          rows={5}
          style={{ font: "inherit", fontFamily: "monospace", width: "24ch" }}
        />
        <div>
          <button type="button" onClick={() => updateText(DEFAULT_TILES_TEXT)}>
            Reset to default set
          </button>
        </div>
      </div>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <label>
          width: <input type="number" min={1} value={width} onChange={(e) => graph.set(ids.width, Math.max(1, Number(e.target.value)))} style={{ font: "inherit", width: "5ch" }} />
        </label>
        <label>
          height: <input type="number" min={1} value={height} onChange={(e) => graph.set(ids.height, Math.max(1, Number(e.target.value)))} style={{ font: "inherit", width: "5ch" }} />
        </label>
        <label>
          solver:{" "}
          <select value={solver} onChange={(e) => graph.set(ids.solver, e.target.value as TilesSolverKind)}>
            <option value="wang">Backtracking</option>
            <option value="torus">Backtracking (torus/periodic)</option>
            <option value="sat">SAT cross-check</option>
          </select>
        </label>
        {solver !== "sat" && (
          <label>
            <input type="checkbox" checked={showAnimation} onChange={(e) => graph.set(ids.showAnimation, e.target.checked)} /> Animate step by step
          </label>
        )}
      </div>

      {!tileSetResult.ok && <p style={{ color: "crimson" }}>{tileSetResult.message}</p>}
      {solveStatus === "error" && <p style={{ color: "crimson" }}>{solveError}</p>}

      <canvas ref={canvasRef} width={canvasWidth} height={canvasHeight} style={{ border: "1px solid #ccc", maxWidth: "100%" }} />
      <div style={{ margin: "0.25rem 0" }}>
        <PngExportButton getCanvas={() => canvasRef.current} label="tiles" />
      </div>

      {showAnimation && solver !== "sat" && solveSteps.length > 0 && (
        <>
          <TransportControls graph={graph} time={time} duration={duration} playing={playing} setPlaying={setPlaying} loop={loop} setLoop={setLoop} speed={speed} setSpeed={setSpeed} />
          {currentStep && (
            <p style={{ fontSize: "0.85rem", color: "var(--muted)" }} aria-live="polite">
              {stepLabel(currentStep)}
            </p>
          )}
        </>
      )}

      {solveStatus === "solving" && <p>Solving…</p>}
      {solveStatus === "done" && (
        <p>
          {solveGrid
            ? `Tiling found${solver !== "sat" ? ` in ${solveSteps.length} search steps` : ""}.`
            : `No tiling exists for this tile set at ${width}x${height}${solver !== "sat" ? ` (search exhausted after ${solveSteps.length} steps)` : ""}.`}
        </p>
      )}
    </div>
  );
}
