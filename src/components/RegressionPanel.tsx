import { GraphUtils, Numerical, Statistics, Symbolic, Vector, type Path2D } from "mallory-math";
import { addLocalSave } from "../lib/local-saves.ts";
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsRegression, type CellIdsRegression } from "../lib/cell-ids.ts";
import { collectFreeVars } from "../lib/free-vars.ts";
import { preprocessImplicitMultiplication } from "../lib/implicit-mult.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useUndoHistory } from "../hooks/use-undo-history.ts";
import { appendRow, paletteColor, removeRow } from "../lib/multi-panel-rows.ts";
import {
  DEFAULT_REGRESSION_STATE,
  decodeRegressionState,
  encodeRegressionState,
  type RegressionDatasetState,
  type RegressionState,
} from "../lib/regression-state.ts";
import { drawAxes, drawPath, drawPoint, drawScatter, type Viewport } from "../lib/render-path.ts";
import { findOutlierIndices, fitRobustLinear, type RobustLinearFit } from "../lib/robust-regression.ts";
import { layersToSvgDocument, type SvgLayer } from "../lib/svg-export.ts";
import { useCell } from "../lib/use-cell.ts";
import { PngExportButton } from "./PngExportButton.tsx";
import { SvgExportButton } from "./SvgExportButton.tsx";

const WIDTH = 500;
const HEIGHT = 500;
const CURVE_SAMPLES = 200;
const FALLBACK_VIEWPORT: Viewport = { xMin: -1, xMax: 10, yMin: -1, yMax: 10 };

/** One (x, y) spreadsheet point within a dataset -- the React/cell-key half of a `RegressionPointState`, one level BELOW a dataset (see cellIdsRegression's own doc comment for the "row"-vocabulary collision this naming avoids). */
interface RegressionPoint {
  id: string;
  x: string;
  y: string;
}

type FitType = "linear" | "nonlinear";
type LinearLossMode = "leastSquares" | "huber";
export type HuberFitResult = { ok: true; value: RobustLinearFit } | { ok: false; message: string } | null;

type FitResult =
  | { ok: true; kind: "linear"; slope: number; intercept: number; r: number; points: { x: number; y: number }[] }
  | {
      ok: true;
      kind: "nonlinear";
      paramOrder: string[];
      params: Record<string, number>;
      residualNorm: number;
      rSquared: number;
      points: { x: number; y: number }[];
    }
  | { ok: false; message: string };

export interface RegressionPlot {
  viewport: Viewport;
  scatterPoints: { x: number; y: number }[];
  /** The fit curve, or null when there are fewer than 2 finite curve points to draw (e.g. every nonlinear sample landed out of domain). */
  curvePath: Path2D | null;
  /** Only non-empty when `showOutliers` is on AND a linear fit (least-squares or Huber) is active -- outlier detection is a linear-regression-only concept. */
  outlierPoints: { x: number; y: number }[];
}

/**
 * Shared by the Canvas2D draw effect and the SVG export getter, so the
 * viewport/curve/outlier math can't drift between the two -- same
 * "shared plot function" convention SignalPanel's `waveformPlot` etc. and
 * StatisticsPanel's `smoothingPlot` already use (issue #45 item 1). Still a
 * per-dataset pure function (#336 item 7's unlimited-datasets port): its own
 * viewport is a scan of just THIS dataset's own fit points, used for
 * nonlinear curve sampling; when several datasets are overlaid, the canvas
 * they're actually drawn onto instead uses a viewport spanning every
 * visible dataset's own points -- see `drawRegressionCanvas`.
 */
export function regressionPlot(
  fit: FitResult,
  modelExpr: string,
  linearLossMode: LinearLossMode,
  huberFitResult: HuberFitResult,
  showOutliers: boolean,
): RegressionPlot | null {
  if (!fit.ok) return null;
  const viewport = autoViewport(fit.points);
  let curvePoints: Vector<number>[];
  let activeLinear: { slope: number; intercept: number } | null = null;
  if (fit.kind === "linear") {
    activeLinear = linearLossMode === "huber" && huberFitResult?.ok ? huberFitResult.value : fit;
    curvePoints = [
      Vector.fromArray([viewport.xMin, activeLinear.slope * viewport.xMin + activeLinear.intercept]),
      Vector.fromArray([viewport.xMax, activeLinear.slope * viewport.xMax + activeLinear.intercept]),
    ];
  } else {
    const compiled = Symbolic.compile(preprocessImplicitMultiplication(modelExpr));
    curvePoints = [];
    for (let i = 0; i < CURVE_SAMPLES; i++) {
      const x = viewport.xMin + (i / (CURVE_SAMPLES - 1)) * (viewport.xMax - viewport.xMin);
      const y = compiled({ x, ...fit.params });
      if (Number.isFinite(y)) curvePoints.push(Vector.fromArray([x, y]));
    }
  }
  const curvePath = curvePoints.length > 1 ? GraphUtils.vectorToCurve(Vector.fromArray(curvePoints), 2, 0xdc2626) : null;
  const outlierPoints =
    showOutliers && activeLinear
      ? findOutlierIndices(fit.points, activeLinear.slope, activeLinear.intercept).map((i) => fit.points[i] as { x: number; y: number })
      : [];
  return { viewport, scatterPoints: fit.points, curvePath, outlierPoints };
}

/**
 * Pure re-render of one dataset's own scatter/fit-curve/outliers, extracted
 * from the top-level draw below so `PngExportButton`'s `renderAtScale`
 * (issue #278) can call it against a fresh offscreen canvas at any size.
 * Still per-dataset (#336 item 7): does NOT clear the canvas or draw axes
 * itself -- `drawRegressionCanvas` does that once, then calls this once per
 * visible dataset so every one of them layers onto the same shared canvas
 * in its own color, the way overlaid regression scatter+fit lines are
 * normally read.
 */
export function drawRegressionPanel(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  viewport: Viewport,
  plot: RegressionPlot | null,
  color = 0x2563eb,
): void {
  if (!plot) return;
  const hexColor = `#${color.toString(16).padStart(6, "0")}`;
  drawScatter(ctx, plot.scatterPoints, viewport, width, height, 5, hexColor);
  if (plot.curvePath) drawPath(ctx, { ...plot.curvePath, stroke: { ...plot.curvePath.stroke, color } }, viewport, width, height);
  for (const p of plot.outlierPoints) drawPoint(ctx, p, viewport, width, height, 7, "#f59e0b");
}

/**
 * Top-level "draw everything" entry point (#336 item 7, unlimited
 * datasets): clears the canvas and draws axes ONCE against the shared
 * viewport, then layers every visible dataset's own scatter+curve+outliers
 * (via `drawRegressionPanel`) on top in its own color. Unlike
 * OdeSystemPanel's own multi-row port -- where overlaying N background
 * vector fields would be unreadable noise -- overlaying N regression
 * scatter+fit-line pairs in different colors is a completely standard,
 * readable visualization, so every visible dataset is drawn, not just a
 * "primary" one.
 */
export function drawRegressionCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  viewport: Viewport,
  datasets: Array<{ plot: RegressionPlot | null; color: number }>,
): void {
  ctx.clearRect(0, 0, width, height);
  drawAxes(ctx, viewport, width, height);
  for (const { plot, color } of datasets) drawRegressionPanel(ctx, width, height, viewport, plot, color);
}

/** Free variables of `modelText` besides `x` -- the nonlinear model's fit parameters. Empty (not thrown) on a mid-typing parse error. */
function modelParams(modelText: string): string[] {
  try {
    return collectFreeVars(Symbolic.parse(preprocessImplicitMultiplication(modelText)), "x");
  } catch {
    return [];
  }
}

/**
 * Seeds one dataset's own cells (#336 item 7, unlimited overlaid datasets):
 * its own (x, y) point list, fit type, nonlinear model/param guesses, color
 * and visibility, its own linear-loss-mode/outlier/Huber-fit auxiliary
 * cells, and its own derived `fit`. Mirrors OdePanel/OdeSystemPanel's own
 * `seedOdeRow`/`seedOdeSystemRow`.
 */
export function seedRegressionDataset(graph: CellGraph, datasetId: string, dataset: RegressionDatasetState): void {
  const ids = cellIdsRegression(datasetId);
  const points: RegressionPoint[] = dataset.points.map(({ x, y }) => ({ id: crypto.randomUUID(), x, y }));
  graph.set(ids.points, points);
  graph.set(ids.fitType, dataset.fitType as FitType);
  graph.set(ids.modelExpr, dataset.modelExpr);
  graph.set(ids.paramGuesses, dataset.paramGuesses);
  graph.set(ids.color, dataset.color);
  graph.set(ids.visible, dataset.visible);
  graph.set(ids.linearLossMode, "leastSquares" as LinearLossMode, { auxiliary: true });
  graph.set(ids.showOutliers, false, { auxiliary: true });
  graph.set(ids.huberFitting, false, { auxiliary: true });
  graph.set<HuberFitResult>(ids.huberFitResult, null, { auxiliary: true });

  graph.define(ids.fit, (): FitResult => {
    try {
      const currentPoints = graph.get<RegressionPoint[]>(ids.points);
      const pts = currentPoints
        .filter((p) => p.x.trim() !== "" || p.y.trim() !== "")
        .map((p) => ({ x: Number(p.x), y: Number(p.y) }));
      if (pts.length < 2) throw new Error("Enter at least two (x, y) rows.");
      if (pts.some((p) => Number.isNaN(p.x) || Number.isNaN(p.y))) {
        throw new Error("Every row needs both x and y filled in as numbers.");
      }

      const fitType = graph.get<FitType>(ids.fitType);
      if (fitType === "linear") {
        const xVec = new Vector<number>(...pts.map((p) => p.x));
        const yVec = new Vector<number>(...pts.map((p) => p.y));
        const [slope, intercept] = Statistics.linearRegression(xVec, yVec);
        const r = Statistics.correlation(xVec, yVec);
        return { ok: true, kind: "linear", slope: slope as number, intercept: intercept as number, r, points: pts };
      }

      const modelText = graph.get<string>(ids.modelExpr);
      const parsed = Symbolic.parse(preprocessImplicitMultiplication(modelText));
      const paramOrder = collectFreeVars(parsed, "x");
      if (paramOrder.length === 0) throw new Error("Model must reference at least one parameter besides x.");
      const compiled = Symbolic.compile(parsed);
      const model = (x: number, p: number[]): number => {
        const env: Record<string, number> = { x };
        paramOrder.forEach((name, i) => {
          env[name] = p[i] as number;
        });
        return compiled(env);
      };
      const guesses = graph.get<Record<string, string>>(ids.paramGuesses);
      const params0 = paramOrder.map((name) => {
        const g = Number(guesses[name] ?? "1");
        return Number.isNaN(g) ? 1 : g;
      });
      const result = Numerical.levenbergMarquardt(
        model,
        params0,
        pts.map((p) => p.x),
        pts.map((p) => p.y),
      );
      if (!result.converged) {
        throw new Error(`Fit did not converge (residual norm ${result.residualNorm.toFixed(4)}) -- try different initial guesses.`);
      }
      const params: Record<string, number> = {};
      paramOrder.forEach((name, i) => {
        params[name] = result.params[i] as number;
      });
      // R^2 = 1 - SS_res/SS_tot, the same goodness-of-fit convention the
      // linear path already shows via r/r^2 -- SS_res is just
      // residualNorm^2 (Numerical.levenbergMarquardt's own convention:
      // residualNorm is the sqrt of the summed squared residuals).
      const yMean = pts.reduce((sum, p) => sum + p.y, 0) / pts.length;
      const ssTot = pts.reduce((sum, p) => sum + (p.y - yMean) ** 2, 0);
      const rSquared = 1 - result.residualNorm ** 2 / ssTot;
      return { ok: true, kind: "nonlinear", paramOrder, params, residualNorm: result.residualNorm, rSquared, points: pts };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });
}

function seedRegressionDatasetDefault(graph: CellGraph, datasetId: string, index: number): void {
  seedRegressionDataset(graph, datasetId, { ...(DEFAULT_REGRESSION_STATE.datasets[0] as RegressionDatasetState), color: paletteColor(index) });
}

/**
 * Full re-seed of the container: clears any existing datasets (deleting
 * their cells) and seeds fresh ones from `state.datasets` -- same "delete
 * then replay" shape OdePanel's/OdeSystemPanel's own `seedOdeState`/
 * `seedOdeSystemState` use, needed because a notebook block's seeding
 * effect runs AFTER `useRegressionGraph` has already constructed one
 * default dataset.
 */
export function seedRegressionState(graph: CellGraph, containerIds: CellIdsRegression, state: RegressionState): void {
  const existing = graph.has(containerIds.list) ? graph.get<string[]>(containerIds.list) : [];
  for (const datasetId of existing) removeRow(graph, containerIds.list, datasetId, cellIdsRegression(datasetId));
  const datasetIds = state.datasets.map(() => crypto.randomUUID());
  graph.set(containerIds.list, datasetIds, { auxiliary: true });
  datasetIds.forEach((id, i) => seedRegressionDataset(graph, id, state.datasets[i] as RegressionDatasetState));
}

/** Builds the full serializable state of a regression panel -- shared by the URL-sync effect and the save-to-gallery handler. */
export function getCurrentRegressionState(graph: CellGraph, containerIds: CellIdsRegression): RegressionState {
  return {
    v: 2,
    datasets: graph.get<string[]>(containerIds.list).map((datasetId) => {
      const ids = cellIdsRegression(datasetId);
      return {
        points: graph.get<RegressionPoint[]>(ids.points).map(({ x, y }) => ({ x, y })),
        fitType: graph.get<FitType>(ids.fitType),
        modelExpr: graph.get<string>(ids.modelExpr),
        paramGuesses: graph.get<Record<string, string>>(ids.paramGuesses),
        color: graph.get<number>(ids.color),
        visible: graph.get<boolean>(ids.visible),
      };
    }),
  };
}

/**
 * Sets up the regression panel's reactive cells -- an ordered list of
 * dataset rows sharing one auto-computed viewport, yet another shape
 * distinct from every other panel's, so (like SystemSolverPanel/
 * StatisticsPanel/OdePanel/ImplicitPanel/ParametricPanel) it gets its own
 * small private CellGraph. Each dataset gets a fit-type toggle between
 * `Statistics.linearRegression`/`correlation` and
 * `Numerical.levenbergMarquardt` for an arbitrary user-supplied nonlinear
 * model. Shares an `externalGraph` when supplied instead of creating a
 * private one, mirroring OdePanel's `useOdeGraph`.
 */
function useRegressionGraph(cellId: string, externalGraph?: CellGraph): CellGraph {
  const ref = useRef<CellGraph | null>(null);
  if (!ref.current) {
    const graph = externalGraph ?? new CellGraph();
    const containerIds = cellIdsRegression(cellId);
    if (!graph.has(containerIds.list)) {
      graph.set(containerIds.list, [] as string[], { auxiliary: true });
      const decoded = !externalGraph && typeof window !== "undefined" ? decodeRegressionState(window.location.hash.slice(1)) : null;
      seedRegressionState(graph, containerIds, decoded ?? DEFAULT_REGRESSION_STATE);
    }
    ref.current = graph;
  }
  return ref.current;
}

/** One (fit, modelExpr, linearLossMode, huberFitResult, showOutliers) input tuple `collectRegressionDrawState`'s own per-dataset memo cache last saw, plus the plot it produced. */
interface RegressionPlotCacheEntry {
  fit: FitResult;
  modelExpr: string;
  linearLossMode: LinearLossMode;
  huberFitResult: HuberFitResult;
  showOutliers: boolean;
  plot: RegressionPlot | null;
}

/**
 * Reads every visible dataset's own draw-relevant cells off `graph` and
 * returns the shared viewport (spanning every visible dataset's own fit
 * points -- issue #336 item 7) plus each one's {plot, color}, ready for
 * `drawRegressionCanvas`. `plotCache` (keyed by dataset id) is
 * `regressionPlot`'s own memoization (issue #236), generalized from the
 * single-dataset top-level `useMemo` this used to be: `regressionPlot` does
 * real work (a viewport bounds scan, curve sampling -- up to CURVE_SAMPLES
 * Symbolic evaluations for a nonlinear model -- and outlier detection), so
 * it's only re-invoked for a dataset whose own five inputs (fit/modelExpr/
 * linearLossMode/huberFitResult/showOutliers) actually changed by
 * reference since the last call -- CellGraph's own get()/set() already
 * structural-equality-gate a cell's reference identity across unrelated
 * writes (see cell-graph.ts's own doc comment), so reference comparison
 * here is safe. Passing no cache (e.g. a one-off PNG/SVG export) simply
 * means every dataset's plot is freshly computed, which is fine for a
 * click-triggered, non-hot-path render.
 */
function collectRegressionDrawState(
  graph: CellGraph,
  containerIds: CellIdsRegression,
  plotCache: Map<string, RegressionPlotCacheEntry> = new Map(),
): { viewport: Viewport; datasets: Array<{ plot: RegressionPlot | null; color: number }> } {
  const datasets: Array<{ plot: RegressionPlot | null; color: number }> = [];
  const seen = new Set<string>();
  for (const datasetId of graph.get<string[]>(containerIds.list)) {
    const ids = cellIdsRegression(datasetId);
    try {
      if (!graph.get<boolean>(ids.visible)) continue;
      const fit = graph.get<FitResult>(ids.fit);
      const modelExpr = graph.get<string>(ids.modelExpr);
      const linearLossMode = graph.get<LinearLossMode>(ids.linearLossMode);
      const huberFitResult = graph.get<HuberFitResult>(ids.huberFitResult);
      const showOutliers = graph.get<boolean>(ids.showOutliers);
      const color = graph.get<number>(ids.color);
      seen.add(datasetId);

      const cached = plotCache.get(datasetId);
      const plot =
        cached &&
        cached.fit === fit &&
        cached.modelExpr === modelExpr &&
        cached.linearLossMode === linearLossMode &&
        cached.huberFitResult === huberFitResult &&
        cached.showOutliers === showOutliers
          ? cached.plot
          : regressionPlot(fit, modelExpr, linearLossMode, huberFitResult, showOutliers);
      plotCache.set(datasetId, { fit, modelExpr, linearLossMode, huberFitResult, showOutliers, plot });
      datasets.push({ plot, color });
    } catch {
      // A dataset whose cells haven't registered yet -- skip it this frame.
    }
  }
  // Drop any cache entry for a dataset that's gone (removed, or hidden this
  // pass) so it doesn't linger forever and doesn't accidentally get reused
  // if a NEW dataset ever reused the same freshly-minted id (astronomically
  // unlikely with crypto.randomUUID(), but free to guard against anyway).
  for (const id of [...plotCache.keys()]) if (!seen.has(id)) plotCache.delete(id);

  const allPoints = datasets.flatMap((d) => d.plot?.scatterPoints ?? []);
  const viewport = allPoints.length > 0 ? autoViewport(allPoints) : FALLBACK_VIEWPORT;
  return { viewport, datasets };
}

export interface RegressionPanelProps {
  cellId?: string;
  /** Share an existing CellGraph (e.g. from a notebook block) instead of creating a private one. */
  graph?: CellGraph;
  /** Hydrate from and write to the URL fragment. Off for a notebook-embedded instance, whose document owns persistence instead. */
  syncUrl?: boolean;
}

/** One dataset's own controls (#336 item 7): checkbox+color swatch+remove button header, linear/nonlinear toggle, Huber controls, nonlinear model/param inputs, its own (x, y) spreadsheet table, and its own fit-result readout. */
function RegressionDataset({ graph, datasetId, onRemove }: { graph: CellGraph; datasetId: string; onRemove?: () => void }) {
  const ids = cellIdsRegression(datasetId);
  const points = useCell<RegressionPoint[]>(graph, ids.points);
  const fitType = useCell<FitType>(graph, ids.fitType);
  const modelExpr = useCell<string>(graph, ids.modelExpr);
  const paramGuesses = useCell<Record<string, string>>(graph, ids.paramGuesses);
  const fit = useCell<FitResult>(graph, ids.fit);
  const linearLossMode = useCell<LinearLossMode>(graph, ids.linearLossMode);
  const showOutliers = useCell<boolean>(graph, ids.showOutliers);
  const huberFitting = useCell<boolean>(graph, ids.huberFitting);
  const huberFitResult = useCell<HuberFitResult>(graph, ids.huberFitResult);
  const color = useCell<number>(graph, ids.color);
  const visible = useCell<boolean>(graph, ids.visible);

  const [modelExprInput, setModelExprInput] = useState(modelExpr);
  // Keeps the input box in sync when modelExpr changes for a reason other
  // than typing in this box -- e.g. URL-hash hydration -- mirrors
  // GraphCanvas's identically-reasoned effect.
  useEffect(() => {
    setModelExprInput(modelExpr);
  }, [modelExpr]);

  // Point-edit generation counter (issue #237), now per-dataset (#336 item
  // 7): handleFitHuber captures `fit.points` at click time and awaits an
  // async trainer.fit run, but the (x, y) point inputs aren't disabled
  // while it's in flight -- editing a point mid-fit must not let the
  // eventual result (computed from the OLD points) land on top of the
  // now-current data. Each RegressionDataset instance owns its own ref,
  // bumped whenever THIS dataset's own `points` changes -- editing another
  // dataset's points bumps THAT dataset's own separate ref instead, so an
  // in-flight Huber fit here is never discarded by an edit somewhere else.
  const pointsGenerationRef = useRef(0);
  useEffect(() => {
    pointsGenerationRef.current++;
  }, [points]);

  async function handleFitHuber() {
    if (!fit.ok) return;
    const requestGeneration = pointsGenerationRef.current;
    graph.set(ids.huberFitting, true);
    graph.set<HuberFitResult>(ids.huberFitResult, null);
    try {
      const value = await fitRobustLinear(fit.points);
      // Only apply if no point edit landed while this fit was in flight --
      // otherwise `value` was computed from points that no longer match the
      // displayed data (issue #237).
      if (pointsGenerationRef.current === requestGeneration) {
        graph.set<HuberFitResult>(ids.huberFitResult, { ok: true, value });
      }
    } catch (e) {
      if (pointsGenerationRef.current === requestGeneration) {
        graph.set<HuberFitResult>(ids.huberFitResult, { ok: false, message: e instanceof Error ? e.message : String(e) });
      }
    } finally {
      // Always clear the in-flight flag (even when stale) so a superseded
      // fit doesn't leave the button stuck disabled/"Fitting…" forever.
      graph.set(ids.huberFitting, false);
    }
  }

  function updatePoint(pointId: string, field: "x" | "y", value: string) {
    graph.set(
      ids.points,
      points.map((p) => (p.id === pointId ? { ...p, [field]: value } : p)),
    );
  }

  function addPoint() {
    graph.set(ids.points, [...points, { id: crypto.randomUUID(), x: "", y: "" }]);
  }

  function removePoint(pointId: string) {
    graph.set(
      ids.points,
      points.filter((p) => p.id !== pointId),
    );
  }

  function updateModelExpr(value: string) {
    setModelExprInput(value);
    graph.set(ids.modelExpr, value);
  }

  function updateGuess(name: string, value: string) {
    graph.set(ids.paramGuesses, { ...paramGuesses, [name]: value });
  }

  const currentParams = modelParams(modelExprInput);

  return (
    <div style={{ margin: "0.35rem 0", padding: "0.35rem", border: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
        <input type="checkbox" checked={visible} onChange={(e) => graph.set(ids.visible, e.target.checked)} title="Show/hide this dataset" />
        <input
          type="color"
          value={`#${color.toString(16).padStart(6, "0")}`}
          onChange={(e) => graph.set(ids.color, Number.parseInt(e.target.value.slice(1), 16))}
        />
        <label>
          <input type="radio" checked={fitType === "linear"} onChange={() => graph.set(ids.fitType, "linear" as FitType)} /> Linear
        </label>
        <label>
          <input type="radio" checked={fitType === "nonlinear"} onChange={() => graph.set(ids.fitType, "nonlinear" as FitType)} /> Nonlinear
          (custom model)
        </label>
        {onRemove && (
          <button type="button" onClick={onRemove} title="Remove this dataset">
            ✕
          </button>
        )}
      </div>
      {fitType === "linear" && (
        <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
          <label>
            <input
              type="radio"
              checked={linearLossMode === "leastSquares"}
              onChange={() => graph.set(ids.linearLossMode, "leastSquares" as LinearLossMode)}
            />{" "}
            Least squares
          </label>
          <label>
            <input
              type="radio"
              checked={linearLossMode === "huber"}
              onChange={() => graph.set(ids.linearLossMode, "huber" as LinearLossMode)}
            />{" "}
            Huber (robust)
          </label>
          {linearLossMode === "huber" && (
            <button type="button" onClick={handleFitHuber} disabled={huberFitting || !fit.ok}>
              {huberFitting ? "Fitting…" : "Fit (Huber)"}
            </button>
          )}
          <label>
            <input type="checkbox" checked={showOutliers} onChange={(e) => graph.set(ids.showOutliers, e.target.checked)} /> highlight
            outliers
          </label>
        </div>
      )}
      {linearLossMode === "huber" && huberFitResult && (
        <p style={{ margin: "0.25rem 0" }}>
          {huberFitResult.ok ? (
            <>
              Huber fit: y = {huberFitResult.value.slope.toFixed(4)}x + {huberFitResult.value.intercept.toFixed(4)}
            </>
          ) : (
            <span style={{ color: "var(--danger)" }}>{huberFitResult.message}</span>
          )}
        </p>
      )}
      {fitType === "nonlinear" && (
        <div style={{ margin: "0.25rem 0" }}>
          <label>
            y ={" "}
            <input
              value={modelExprInput}
              onChange={(e) => updateModelExpr(e.target.value)}
              style={{ font: "inherit", width: "18ch" }}
            />
          </label>{" "}
          {currentParams.map((name) => (
            <label key={name} style={{ marginLeft: "0.5rem" }}>
              {name}₀ ={" "}
              <input
                value={paramGuesses[name] ?? "1"}
                onChange={(e) => updateGuess(name, e.target.value)}
                style={{ font: "inherit", width: "5ch" }}
              />
            </label>
          ))}
        </div>
      )}
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={headerCellStyle}>x</th>
              <th style={headerCellStyle}>y</th>
              <th style={headerCellStyle} />
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.id}>
                <td style={dataCellStyle}>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    value={p.x}
                    onChange={(e) => updatePoint(p.id, "x", e.target.value)}
                    style={{ font: "inherit", width: "8ch", maxWidth: "100%" }}
                  />
                </td>
                <td style={dataCellStyle}>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    value={p.y}
                    onChange={(e) => updatePoint(p.id, "y", e.target.value)}
                    style={{ font: "inherit", width: "8ch", maxWidth: "100%" }}
                  />
                </td>
                <td style={dataCellStyle}>
                  <button
                    type="button"
                    onClick={() => removePoint(p.id)}
                    disabled={points.length <= 1}
                    aria-label="Remove point"
                    title="Remove point"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" onClick={addPoint} style={{ margin: "0.5rem 0" }}>
        + Add point
      </button>
      {fit.ok ? (
        fit.kind === "linear" ? (
          <p>
            y = {fit.slope.toFixed(4)}x + {fit.intercept.toFixed(4)} (r = {fit.r.toFixed(4)}, r² ={" "}
            {(fit.r * fit.r).toFixed(4)})
          </p>
        ) : (
          <p>
            {fit.paramOrder.map((name, i) => (
              <span key={name}>
                {i > 0 ? ", " : ""}
                {name} = {(fit.params[name] as number).toFixed(4)}
              </span>
            ))}{" "}
            (residual norm = {fit.residualNorm.toFixed(6)}, r² = {fit.rSquared.toFixed(4)})
          </p>
        )
      ) : (
        <p style={{ color: "var(--danger)" }}>{fit.message}</p>
      )}
    </div>
  );
}

/** Linear regression (least squares) or a nonlinear (Levenberg-Marquardt) fit to a custom model, over unlimited overlaid datasets (#336 item 7), each with its own spreadsheet-style (x, y) row list and its own fit, plotted together on one shared, auto-computed viewport. */
export function RegressionPanel({ cellId = "regression-1", graph: externalGraph, syncUrl = true }: RegressionPanelProps = {}) {
  const graph = useRegressionGraph(cellId, externalGraph);
  // Namespaced by cellId, same collision-avoidance fix as OdePanel's.
  useCellGraphTools(`data_regression_${cellId}`, graph);
  const containerIds = cellIdsRegression(cellId);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const datasetIds = useCell<string[]>(graph, containerIds.list);

  // Standalone only (issue #43): a notebook-embedded instance shares its
  // graph with NotebookPanel, which already runs its own useUndoHistory over
  // the whole document -- a second independent history here would double-
  // fire on Ctrl+Z. `enabled: syncUrl` mirrors the "Save to gallery" button's
  // own standalone-only gating just below.
  const history = useUndoHistory(
    graph,
    () => getCurrentRegressionState(graph, containerIds),
    (state) => seedRegressionState(graph, containerIds, state),
    250,
    undefined,
    syncUrl,
  );

  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  function addDataset() {
    const { id, index } = appendRow(graph, containerIds.list);
    seedRegressionDatasetDefault(graph, id, index);
  }

  function removeDataset(datasetId: string) {
    removeRow(graph, containerIds.list, datasetId, cellIdsRegression(datasetId));
  }

  async function handleSave() {
    const title = window.prompt("Title for this saved regression:", "Untitled");
    if (title === null) return;
    try {
      addLocalSave({ title, kind: "regression", state: getCurrentRegressionState(graph, containerIds) });
      setSaveStatus(`Saved as "${title || "Untitled"}" to My saves on this device — reopen or publish it from the gallery.`);
    } catch (e) {
      setSaveStatus(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Keep the URL fragment in sync with the live graph state, mirroring OdePanel's pattern.
  useEffect(() => {
    if (!syncUrl) return;
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeRegressionState(getCurrentRegressionState(graph, containerIds))}`);
    }
    writeUrl();
    return graph.subscribeAll(writeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, syncUrl]);

  // Per-dataset `regressionPlot` memoization (issue #236), generalized from
  // the single-dataset top-level `useMemo` this used to be -- see
  // `collectRegressionDrawState`'s own doc comment. Persists for this
  // component instance's whole lifetime (like `useRegressionGraph`'s own
  // ref), so a dataset's curve is only ever resampled when its own five
  // relevant inputs actually change.
  const plotCacheRef = useRef(new Map<string, RegressionPlotCacheEntry>());

  // Redraws whenever the dataset list changes, or any individual dataset's
  // own cells do (points/fitType/model/color/visible/fit/...) --
  // graph.subscribeAll rather than per-dataset useCell hooks, same
  // reasoning as every other multi-row panel's own redraw effect.
  //
  // `collectRegressionDrawState` (and therefore each dataset's own
  // memoized `regressionPlot`) is called UNCONDITIONALLY, before the
  // ctx-availability check -- the plot cache must stay populated purely
  // off graph writes so a dataset's curve is resampled at most once per
  // real input change regardless of whether there's currently a live
  // canvas to draw it onto (mirrors the old single-dataset top-level
  // `useMemo`'s own render-time-not-draw-time timing).
  useEffect(() => {
    function redraw() {
      const { viewport, datasets } = collectRegressionDrawState(graph, containerIds, plotCacheRef.current);
      const ctx = canvasRef.current?.getContext("2d");
      if (!ctx) return;
      drawRegressionCanvas(ctx, WIDTH, HEIGHT, viewport, datasets);
    }
    redraw();
    return graph.subscribeAll(redraw);
  }, [graph, containerIds]);

  return (
    <div>
      {datasetIds.map((datasetId) => (
        <RegressionDataset
          key={datasetId}
          graph={graph}
          datasetId={datasetId}
          onRemove={datasetIds.length > 1 ? () => removeDataset(datasetId) : undefined}
        />
      ))}
      <button type="button" onClick={addDataset} style={{ margin: "0.35rem 0" }}>
        + Add dataset
      </button>
      <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} style={{ border: "1px solid var(--border)" }} />
      <div style={{ margin: "0.25rem 0" }}>
        <PngExportButton
          getCanvas={() => canvasRef.current}
          label="regression"
          renderAtScale={(ctx, width, height) => {
            const { viewport, datasets } = collectRegressionDrawState(graph, containerIds);
            drawRegressionCanvas(ctx, width, height, viewport, datasets);
          }}
          baseWidth={WIDTH}
          baseHeight={HEIGHT}
        />{" "}
        <SvgExportButton
          getSvg={() => {
            const { viewport, datasets } = collectRegressionDrawState(graph, containerIds);
            const layers: SvgLayer[] = [];
            for (const { plot, color } of datasets) {
              if (!plot) continue;
              const hexColor = `#${color.toString(16).padStart(6, "0")}`;
              layers.push({ kind: "scatter", points: plot.scatterPoints, color: hexColor });
              if (plot.curvePath) layers.push({ kind: "path", path: { ...plot.curvePath, stroke: { ...plot.curvePath.stroke, color } } });
              layers.push({ kind: "scatter", points: plot.outlierPoints, color: "#f59e0b", radius: 7 });
            }
            return layers.length > 0 ? layersToSvgDocument(layers, viewport, WIDTH, HEIGHT) : null;
          }}
          label="regression"
        />
      </div>
      {syncUrl && (
        <div style={{ margin: "0.5rem 0" }}>
          <button type="button" onClick={handleSave}>
            Save
          </button>{" "}
          <button type="button" onClick={history.undo} disabled={!history.canUndo} title="Undo (Ctrl+Z / Cmd+Z)">
            ↩ Undo
          </button>{" "}
          <button type="button" onClick={history.redo} disabled={!history.canRedo} title="Redo (Ctrl+Shift+Z / Cmd+Y)">
            ↪ Redo
          </button>
          {saveStatus && <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>{saveStatus}</p>}
        </div>
      )}
    </div>
  );
}

const headerCellStyle: CSSProperties = { textAlign: "left", padding: "0.15rem 0.6rem", borderBottom: "1px solid var(--border)", fontWeight: 600 };
const dataCellStyle: CSSProperties = { padding: "0.15rem 0.6rem" };

function autoViewport(points: { x: number; y: number }[]): Viewport {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const xPad = (xMax - xMin || 1) * 0.15;
  const yPad = (yMax - yMin || 1) * 0.15;
  return { xMin: xMin - xPad, xMax: xMax + xPad, yMin: yMin - yPad, yMax: yMax + yPad };
}
