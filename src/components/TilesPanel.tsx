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
import { autocorrelationSurface, diffractionSpectrum, tileIdsPresent } from "../lib/tiles/diffraction.ts";
import { stripEntropy, type StripEntropyResult } from "../lib/tiles/entropy.ts";
import { expandTileSetSymmetry, type SymmetryGroup } from "../lib/tiles/symmetry.ts";
import { solveTorus, solveWang, solveWangViaSat, type SolveStep, type TileSet, type WangGrid } from "../lib/tiles/tile-model.ts";
import { useCell } from "../lib/use-cell.ts";
import { useTimelinePlayback } from "../lib/use-timeline-playback.ts";
import { drawGrayscaleGrid } from "../lib/image-frequency.ts";
import { PngExportButton } from "./PngExportButton.tsx";
import { TransportControls } from "./TransportControls.tsx";

type Result<T> = { ok: true; value: T } | { ok: false; message: string };
type SolveStatus = "idle" | "solving" | "done" | "error";
type EntropyStatus = "idle" | "computing" | "done" | "error";
interface DiffractionResult {
  spectrum: number[][];
  autocorrelation: number[][];
}
const DIFFRACTION_CANVAS_SIZE = 200;

// stripEntropy's own transfer-matrix build is O(numColumns^2), and
// numColumns can be as large as (expanded tile count)^height -- this caps
// that product before calling it, so a careless height/symmetry
// combination degrades to a friendly error instead of freezing the tab.
// 4000^2 = 16M pairwise compatibility checks, comfortably sub-second.
const MAX_ENTROPY_COLUMNS = 4000;

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
  graph.set(ids.symmetry, state.symmetry);
}

function getCurrentState(graph: CellGraph, ids: CellIdsTiles): TilesState {
  return {
    v: 2,
    tilesText: graph.get<string>(ids.tilesText),
    width: graph.get<number>(ids.width),
    height: graph.get<number>(ids.height),
    solver: graph.get<TilesSolverKind>(ids.solver),
    showAnimation: graph.get<boolean>(ids.showAnimation),
    symmetry: graph.get<SymmetryGroup>(ids.symmetry),
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
    graph.set(ids.entropyHeight, 1, { auxiliary: true });
    graph.set(ids.entropyStatus, "idle" as EntropyStatus, { auxiliary: true });
    graph.set(ids.entropyResult, null as StripEntropyResult | null, { auxiliary: true });
    graph.set(ids.entropyError, "", { auxiliary: true });
    graph.set(ids.diffractionTileId, "", { auxiliary: true });

    graph.define(ids.tileSetResult, (): Result<TileSet> => {
      try {
        return { ok: true, value: parseTileSetText(graph.get<string>(ids.tilesText)) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    // Symmetry expansion is pure and synchronous, so unlike solving/entropy
    // it derives on read like the rest of this panel's cells.
    graph.define(ids.expandedTileSetResult, (): Result<TileSet> => {
      const base = graph.get<Result<TileSet>>(ids.tileSetResult);
      if (!base.ok) return base;
      return { ok: true, value: expandTileSetSymmetry(base.value, graph.get<SymmetryGroup>(ids.symmetry)) };
    });

    // Diffraction/autocorrelation: also pure and synchronous (both operate
    // on an already-solved grid, no search of their own), so this derives
    // on read too. `null` means "no completed tiling to analyze yet" or
    // "the selected tile id isn't in this solve" -- both real, common
    // states (an in-progress/failed solve, or a stale selection left over
    // from a since-changed tile set), not errors.
    graph.define(ids.diffractionResult, (): DiffractionResult | null => {
      const grid = graph.get<WangGrid | null>(ids.solveGrid);
      const tileId = graph.get<string>(ids.diffractionTileId);
      if (!grid || !tileId || !tileIdsPresent(grid).includes(tileId)) return null;
      return { spectrum: diffractionSpectrum(grid, tileId), autocorrelation: autocorrelationSurface(grid, tileId) };
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
  const symmetry = useCell<SymmetryGroup>(graph, ids.symmetry);
  const expandedTileSetResult = useCell<Result<TileSet>>(graph, ids.expandedTileSetResult);
  const solveStatus = useCell<SolveStatus>(graph, ids.solveStatus);
  const solveSteps = useCell<SolveStep[]>(graph, ids.solveSteps);
  const solveGrid = useCell<WangGrid | null>(graph, ids.solveGrid);
  const solveError = useCell<string>(graph, ids.solveError);
  const entropyHeight = useCell<number>(graph, ids.entropyHeight);
  const entropyStatus = useCell<EntropyStatus>(graph, ids.entropyStatus);
  const entropyResult = useCell<StripEntropyResult | null>(graph, ids.entropyResult);
  const entropyError = useCell<string>(graph, ids.entropyError);
  const diffractionTileId = useCell<string>(graph, ids.diffractionTileId);
  const diffractionResult = useCell<DiffractionResult | null>(graph, ids.diffractionResult);
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
      if (!expandedTileSetResult.ok) {
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
            ? solveTorus(expandedTileSetResult.value, width, height)
            : solveWang(expandedTileSetResult.value, width, height);
        if (solver === "sat") {
          const grid = solveWangViaSat(expandedTileSetResult.value, width, height);
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
  }, [graph, expandedTileSetResult, width, height, solver]);

  // A changed solve restarts the animation from the beginning.
  useEffect(() => {
    graph.set(TIME_CELL, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solveSteps]);

  // Keep the diffraction tile-id selection valid across a new solve: pick
  // the first available id when the current selection isn't (or never was)
  // present in the newly-solved grid. `diffractionResult` itself already
  // reads `solveGrid` in its `define`, so this effect's only job is
  // choosing WHICH id to look at -- it never touches diffractionResult.
  useEffect(() => {
    const available = solveGrid ? tileIdsPresent(solveGrid) : [];
    if (!available.includes(diffractionTileId)) {
      graph.set(ids.diffractionTileId, available[0] ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solveGrid]);

  // A stale entropy result/error for a now-different tile set or height
  // would be actively misleading (unlike solving, entropy is NOT
  // auto-recomputed -- see MAX_ENTROPY_COLUMNS -- so this only clears it
  // back to "idle", it never re-runs stripEntropy itself).
  useEffect(() => {
    graph.set(ids.entropyStatus, "idle" satisfies EntropyStatus);
    graph.set(ids.entropyResult, null);
    graph.set(ids.entropyError, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedTileSetResult, entropyHeight]);

  function computeEntropy() {
    if (!expandedTileSetResult.ok) return;
    const numTiles = expandedTileSetResult.value.tiles.length;
    if (numTiles === 0) {
      graph.set(ids.entropyStatus, "error" satisfies EntropyStatus);
      graph.set(ids.entropyError, "Tile set is empty.");
      return;
    }
    if (numTiles ** entropyHeight > MAX_ENTROPY_COLUMNS) {
      graph.set(ids.entropyStatus, "error" satisfies EntropyStatus);
      graph.set(
        ids.entropyError,
        `${numTiles} tiles at height ${entropyHeight} could reach up to ${numTiles ** entropyHeight} columns, over the ${MAX_ENTROPY_COLUMNS} cap -- lower the height or the symmetry group.`,
      );
      return;
    }
    graph.set(ids.entropyStatus, "computing" satisfies EntropyStatus);
    try {
      const result = stripEntropy(expandedTileSetResult.value, entropyHeight);
      graph.set(ids.entropyResult, result);
      graph.set(ids.entropyError, "");
      graph.set(ids.entropyStatus, "done" satisfies EntropyStatus);
    } catch (e) {
      graph.set(ids.entropyStatus, "error" satisfies EntropyStatus);
      graph.set(ids.entropyError, e instanceof Error ? e.message : String(e));
    }
  }

  useModelContextTool({
    name: `tiles_${cellId}_entropy`,
    description:
      "Compute the panel's current (symmetry-expanded) tile set's strip entropy at its current entropyHeight setting, via the transfer-matrix method. Returns the per-cell entropy, the dominant eigenvalue, and the number of valid columns found, or an error if the tile set admits no valid column/cycle at this height or the search would be too large.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      computeEntropy();
      return {
        status: graph.get<EntropyStatus>(ids.entropyStatus),
        result: graph.get<StripEntropyResult | null>(ids.entropyResult),
        error: graph.get<string>(ids.entropyError),
      };
    },
  });

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

  const diffractionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const autocorrelationCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const ctx = diffractionCanvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, DIFFRACTION_CANVAS_SIZE, DIFFRACTION_CANVAS_SIZE);
    if (!diffractionResult) return;
    // log1p-scaled, same reasoning as ImageFrequencyPanel's own magnitude
    // spectrum: the DC bin dwarfs everything else on a linear scale.
    const logSpectrum = diffractionResult.spectrum.map((row) => row.map((v) => Math.log1p(v)));
    drawGrayscaleGrid(ctx, logSpectrum, DIFFRACTION_CANVAS_SIZE, DIFFRACTION_CANVAS_SIZE);
  }, [diffractionResult]);

  useEffect(() => {
    const ctx = autocorrelationCanvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, DIFFRACTION_CANVAS_SIZE, DIFFRACTION_CANVAS_SIZE);
    if (!diffractionResult) return;
    drawGrayscaleGrid(ctx, diffractionResult.autocorrelation, DIFFRACTION_CANVAS_SIZE, DIFFRACTION_CANVAS_SIZE);
  }, [diffractionResult]);

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
        <label>
          symmetry:{" "}
          <select value={symmetry} onChange={(e) => graph.set(ids.symmetry, e.target.value as SymmetryGroup)}>
            <option value="none">None (translations only)</option>
            <option value="rotations">Rotations (C4)</option>
            <option value="rotations-reflections">Rotations + reflections (D4)</option>
          </select>
        </label>
        {solver !== "sat" && (
          <label>
            <input type="checkbox" checked={showAnimation} onChange={(e) => graph.set(ids.showAnimation, e.target.checked)} /> Animate step by step
          </label>
        )}
      </div>

      {!tileSetResult.ok && <p style={{ color: "crimson" }}>{tileSetResult.message}</p>}
      {tileSetResult.ok && symmetry !== "none" && expandedTileSetResult.ok && (
        <p style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
          Symmetry expansion: {tileSetResult.value.tiles.length} tile{tileSetResult.value.tiles.length === 1 ? "" : "s"} →{" "}
          {expandedTileSetResult.value.tiles.length} oriented variant{expandedTileSetResult.value.tiles.length === 1 ? "" : "s"} used for solving.
        </p>
      )}
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

      <div style={{ margin: "0.75rem 0", paddingTop: "0.5rem", borderTop: "1px solid var(--border, #ccc)" }}>
        <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)" }}>
          Entropy (transfer-matrix method, issue #92 M2) -- per-cell entropy of the height-h strip, using the current symmetry-expanded tile set
        </label>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center", margin: "0.25rem 0" }}>
          <label>
            strip height:{" "}
            <input
              type="number"
              min={1}
              value={entropyHeight}
              onChange={(e) => graph.set(ids.entropyHeight, Math.max(1, Number(e.target.value)))}
              style={{ font: "inherit", width: "4ch" }}
            />
          </label>
          <button type="button" onClick={computeEntropy} disabled={!expandedTileSetResult.ok}>
            Compute entropy
          </button>
        </div>
        {entropyStatus === "error" && <p style={{ color: "crimson" }}>{entropyError}</p>}
        {entropyStatus === "done" && entropyResult && (
          <p>
            entropy ≈ {entropyResult.entropy.toFixed(4)} (dominant eigenvalue ≈ {entropyResult.dominantEigenvalue.toFixed(4)}, {entropyResult.numColumns}{" "}
            valid column{entropyResult.numColumns === 1 ? "" : "s"}
            {!entropyResult.converged ? ", power iteration did not fully converge -- treat as approximate" : ""})
          </p>
        )}
      </div>

      <div style={{ margin: "0.75rem 0", paddingTop: "0.5rem", borderTop: "1px solid var(--border, #ccc)" }}>
        <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)" }}>
          Diffraction spectrum + autocorrelation (issue #92 M3) -- for a solved tiling's indicator field of the chosen tile id
        </label>
        <div style={{ margin: "0.25rem 0" }}>
          <label>
            tile:{" "}
            <select
              value={diffractionTileId}
              onChange={(e) => graph.set(ids.diffractionTileId, e.target.value)}
              disabled={!solveGrid}
            >
              {!solveGrid && <option value="">(no completed tiling yet)</option>}
              {solveGrid &&
                tileIdsPresent(solveGrid).map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
          <div>
            <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "0 0 0.25rem" }}>
              Spectrum (log-scaled, DC centered)
            </p>
            <canvas
              ref={diffractionCanvasRef}
              width={DIFFRACTION_CANVAS_SIZE}
              height={DIFFRACTION_CANVAS_SIZE}
              style={{ border: "1px solid #ccc", maxWidth: "100%" }}
            />
          </div>
          <div>
            <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "0 0 0.25rem" }}>
              Autocorrelation surface (zero-lag centered)
            </p>
            <canvas
              ref={autocorrelationCanvasRef}
              width={DIFFRACTION_CANVAS_SIZE}
              height={DIFFRACTION_CANVAS_SIZE}
              style={{ border: "1px solid #ccc", maxWidth: "100%" }}
            />
          </div>
        </div>
        {!diffractionResult && <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Solve for a tiling to see its diffraction pattern.</p>}
      </div>
    </div>
  );
}
