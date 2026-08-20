import { GraphUtils, Numerical, Statistics, Symbolic, Vector, type Path2D } from "mallory-math";
import { addLocalSave } from "../lib/local-saves.ts";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsRegression, type CellIdsRegression } from "../lib/cell-ids.ts";
import { collectFreeVars } from "../lib/free-vars.ts";
import { preprocessImplicitMultiplication } from "../lib/implicit-mult.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useUndoHistory } from "../hooks/use-undo-history.ts";
import { DEFAULT_REGRESSION_STATE, decodeRegressionState, encodeRegressionState, type RegressionState } from "../lib/regression-state.ts";
import { drawAxes, drawPath, drawPoint, drawScatter, type Viewport } from "../lib/render-path.ts";
import { findOutlierIndices, fitRobustLinear, type RobustLinearFit } from "../lib/robust-regression.ts";
import { layersToSvgDocument } from "../lib/svg-export.ts";
import { useCell } from "../lib/use-cell.ts";
import { PngExportButton } from "./PngExportButton.tsx";
import { SvgExportButton } from "./SvgExportButton.tsx";

const WIDTH = 500;
const HEIGHT = 500;
const CURVE_SAMPLES = 200;

interface RegressionRow {
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
 * StatisticsPanel's `smoothingPlot` already use (issue #45 item 1).
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
 * Pure re-render of the scatter/fit-curve/outliers canvas, extracted from
 * the draw effect below so `PngExportButton`'s `renderAtScale` (issue
 * #278) can call it against a fresh offscreen canvas at any size.
 */
export function drawRegressionPanel(ctx: CanvasRenderingContext2D, width: number, height: number, viewport: Viewport, plot: RegressionPlot | null): void {
  ctx.clearRect(0, 0, width, height);
  drawAxes(ctx, viewport, width, height);
  if (!plot) return;
  drawScatter(ctx, plot.scatterPoints, viewport, width, height);
  if (plot.curvePath) drawPath(ctx, plot.curvePath, viewport, width, height);
  for (const p of plot.outlierPoints) drawPoint(ctx, p, viewport, width, height, 7, "#f59e0b");
}

/** Free variables of `modelText` besides `x` -- the nonlinear model's fit parameters. Empty (not thrown) on a mid-typing parse error. */
function modelParams(modelText: string): string[] {
  try {
    return collectFreeVars(Symbolic.parse(preprocessImplicitMultiplication(modelText)), "x");
  } catch {
    return [];
  }
}

/** Writes a state's fields onto `graph`'s free cells (assigning fresh row ids) -- shared by useRegressionGraph's own hydrate-from-hash and a notebook block's post-mount overwrite. */
export function seedRegressionState(graph: CellGraph, ids: CellIdsRegression, state: RegressionState): void {
  const rows: RegressionRow[] = state.rows.map(({ x, y }) => ({ id: crypto.randomUUID(), x, y }));
  graph.set(ids.rows, rows);
  graph.set(ids.fitType, state.fitType as FitType);
  graph.set(ids.modelExpr, state.modelExpr);
  graph.set(ids.paramGuesses, state.paramGuesses);
}

/** Builds the full serializable state of a regression panel -- shared by the URL-sync effect and the save-to-gallery handler. */
export function getCurrentRegressionState(graph: CellGraph, ids: CellIdsRegression): RegressionState {
  return {
    v: 1,
    rows: graph.get<RegressionRow[]>(ids.rows).map(({ x, y }) => ({ x, y })),
    fitType: graph.get<FitType>(ids.fitType),
    modelExpr: graph.get<string>(ids.modelExpr),
    paramGuesses: graph.get<Record<string, string>>(ids.paramGuesses),
  };
}

/**
 * Sets up the regression panel's reactive cells -- one ordered row list (a
 * shape distinct enough from every other panel's that, like
 * SystemSolverPanel/StatisticsPanel/OdePanel/ImplicitPanel/ParametricPanel,
 * it gets its own small private CellGraph), plus a fit-type toggle between
 * `Statistics.linearRegression`/`correlation` (already existed upstream,
 * unused anywhere in the UI before this) and `Numerical.levenbergMarquardt`
 * for an arbitrary user-supplied nonlinear model. Shares an `externalGraph`
 * when supplied instead of creating a private one, mirroring OdePanel's
 * `useOdeGraph`.
 */
function useRegressionGraph(cellId: string, externalGraph?: CellGraph): CellGraph {
  const ref = useRef<CellGraph | null>(null);
  if (!ref.current) {
    const graph = externalGraph ?? new CellGraph();
    const ids = cellIdsRegression(cellId);
    if (!graph.has(ids.rows)) {
      const decoded = !externalGraph && typeof window !== "undefined" ? decodeRegressionState(window.location.hash.slice(1)) : null;
      seedRegressionState(graph, ids, decoded ?? DEFAULT_REGRESSION_STATE);
      graph.set(ids.linearLossMode, "leastSquares" as LinearLossMode, { auxiliary: true });
      graph.set(ids.showOutliers, false, { auxiliary: true });
      graph.set(ids.huberFitting, false, { auxiliary: true });
      graph.set<HuberFitResult>(ids.huberFitResult, null, { auxiliary: true });

      graph.define(ids.fit, (): FitResult => {
        try {
          const currentRows = graph.get<RegressionRow[]>(ids.rows);
          const points = currentRows
            .filter((row) => row.x.trim() !== "" || row.y.trim() !== "")
            .map((row) => ({ x: Number(row.x), y: Number(row.y) }));
          if (points.length < 2) throw new Error("Enter at least two (x, y) rows.");
          if (points.some((p) => Number.isNaN(p.x) || Number.isNaN(p.y))) {
            throw new Error("Every row needs both x and y filled in as numbers.");
          }

          const fitType = graph.get<FitType>(ids.fitType);
          if (fitType === "linear") {
            const xVec = new Vector<number>(...points.map((p) => p.x));
            const yVec = new Vector<number>(...points.map((p) => p.y));
            const [slope, intercept] = Statistics.linearRegression(xVec, yVec);
            const r = Statistics.correlation(xVec, yVec);
            return { ok: true, kind: "linear", slope: slope as number, intercept: intercept as number, r, points };
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
            points.map((p) => p.x),
            points.map((p) => p.y),
          );
          if (!result.converged) {
            throw new Error(
              `Fit did not converge (residual norm ${result.residualNorm.toFixed(4)}) -- try different initial guesses.`,
            );
          }
          const params: Record<string, number> = {};
          paramOrder.forEach((name, i) => {
            params[name] = result.params[i] as number;
          });
          // R^2 = 1 - SS_res/SS_tot, the same goodness-of-fit convention the
          // linear path already shows via r/r^2 -- SS_res is just
          // residualNorm^2 (Numerical.levenbergMarquardt's own convention:
          // residualNorm is the sqrt of the summed squared residuals).
          const yMean = points.reduce((sum, p) => sum + p.y, 0) / points.length;
          const ssTot = points.reduce((sum, p) => sum + (p.y - yMean) ** 2, 0);
          const rSquared = 1 - result.residualNorm ** 2 / ssTot;
          return { ok: true, kind: "nonlinear", paramOrder, params, residualNorm: result.residualNorm, rSquared, points };
        } catch (e) {
          return { ok: false, message: e instanceof Error ? e.message : String(e) };
        }
      });
    }
    ref.current = graph;
  }
  return ref.current;
}

export interface RegressionPanelProps {
  cellId?: string;
  /** Share an existing CellGraph (e.g. from a notebook block) instead of creating a private one. */
  graph?: CellGraph;
  /** Hydrate from and write to the URL fragment. Off for a notebook-embedded instance, whose document owns persistence instead. */
  syncUrl?: boolean;
}

/** Linear regression (least squares) or a nonlinear (Levenberg-Marquardt) fit to a custom model, over a spreadsheet-style (x, y) row list. */
export function RegressionPanel({ cellId = "regression-1", graph: externalGraph, syncUrl = true }: RegressionPanelProps = {}) {
  const graph = useRegressionGraph(cellId, externalGraph);
  // Namespaced by cellId, same collision-avoidance fix as OdePanel's.
  useCellGraphTools(`data_regression_${cellId}`, graph);
  const ids = cellIdsRegression(cellId);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Standalone only (issue #43): a notebook-embedded instance shares its
  // graph with NotebookPanel, which already runs its own useUndoHistory over
  // the whole document -- a second independent history here would double-
  // fire on Ctrl+Z. `enabled: syncUrl` mirrors the "Save to gallery" button's
  // own standalone-only gating just below.
  const history = useUndoHistory(
    graph,
    () => getCurrentRegressionState(graph, ids),
    (state) => seedRegressionState(graph, ids, state),
    250,
    undefined,
    syncUrl,
  );

  const rows = useCell<RegressionRow[]>(graph, ids.rows);
  const fitType = useCell<FitType>(graph, ids.fitType);
  const modelExpr = useCell<string>(graph, ids.modelExpr);
  const paramGuesses = useCell<Record<string, string>>(graph, ids.paramGuesses);
  const fit = useCell<FitResult>(graph, ids.fit);
  const linearLossMode = useCell<LinearLossMode>(graph, ids.linearLossMode);
  const showOutliers = useCell<boolean>(graph, ids.showOutliers);
  const huberFitting = useCell<boolean>(graph, ids.huberFitting);
  const huberFitResult = useCell<HuberFitResult>(graph, ids.huberFitResult);

  const [modelExprInput, setModelExprInput] = useState(modelExpr);
  // Keeps the input box in sync when modelExpr changes for a reason other
  // than typing in this box -- e.g. URL-hash hydration -- mirrors
  // GraphCanvas's identically-reasoned effect.
  useEffect(() => {
    setModelExprInput(modelExpr);
  }, [modelExpr]);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  // Row-edit generation counter (issue #237): handleFitHuber captures
  // `fit.points` at click time and awaits an async trainer.fit run, but the
  // (x, y) row inputs aren't disabled while it's in flight -- editing a row
  // mid-fit must not let the eventual result (computed from the OLD points)
  // land on top of the now-current data. Bumped whenever `rows` changes;
  // handleFitHuber compares its captured generation against the latest one
  // before applying its result, discarding it if rows moved on since.
  const rowsGenerationRef = useRef(0);
  useEffect(() => {
    rowsGenerationRef.current++;
  }, [rows]);

  async function handleSave() {
    const title = window.prompt("Title for this saved regression:", "Untitled");
    if (title === null) return;
        try {
      addLocalSave({ title, kind: "regression", state: getCurrentRegressionState(graph, ids) });
      setSaveStatus(`Saved as "${title || "Untitled"}" to My saves on this device — reopen or publish it from the gallery.`);
    } catch (e) {
      setSaveStatus(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Imperative, not a reactive graph.define compute (fitRobustLinear's
  // trainer.fit is async -- CellGraph computes are synchronous), matching
  // MlPlaygroundPanel's own precedent for the same reason.
  async function handleFitHuber() {
    if (!fit.ok) return;
    const requestGeneration = rowsGenerationRef.current;
    graph.set(ids.huberFitting, true);
    graph.set<HuberFitResult>(ids.huberFitResult, null);
    try {
      const value = await fitRobustLinear(fit.points);
      // Only apply if no row edit landed while this fit was in flight --
      // otherwise `value` was computed from points that no longer match the
      // displayed data (issue #237).
      if (rowsGenerationRef.current === requestGeneration) {
        graph.set<HuberFitResult>(ids.huberFitResult, { ok: true, value });
      }
    } catch (e) {
      if (rowsGenerationRef.current === requestGeneration) {
        graph.set<HuberFitResult>(ids.huberFitResult, { ok: false, message: e instanceof Error ? e.message : String(e) });
      }
    } finally {
      // Always clear the in-flight flag (even when stale) so a superseded
      // fit doesn't leave the button stuck disabled/"Fitting…" forever.
      graph.set(ids.huberFitting, false);
    }
  }

  // Keep the URL fragment in sync with the live graph state, mirroring OdePanel's pattern.
  useEffect(() => {
    if (!syncUrl) return;
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeRegressionState(getCurrentRegressionState(graph, ids))}`);
    }
    writeUrl();
    return graph.subscribeAll(writeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, syncUrl]);

  const FALLBACK_VIEWPORT: Viewport = { xMin: -1, xMax: 10, yMin: -1, yMax: 10 };
  // regressionPlot does real work (viewport bounds scan, curve sampling --
  // up to CURVE_SAMPLES Symbolic evaluations for a nonlinear model, outlier
  // detection) -- memoized (issue #236) so a re-render triggered by
  // something that doesn't feed regressionPlot (e.g. huberFitting's
  // loading-button toggle, or the "Save to gallery" status message) skips
  // it, matching the exact dependency set the draw effect below already
  // uses.
  const plot = useMemo(
    () => regressionPlot(fit, modelExpr, linearLossMode, huberFitResult, showOutliers),
    [fit, modelExpr, linearLossMode, huberFitResult, showOutliers],
  );
  const viewport: Viewport = plot?.viewport ?? FALLBACK_VIEWPORT;

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawRegressionPanel(ctx, WIDTH, HEIGHT, viewport, plot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit, modelExpr, linearLossMode, huberFitResult, showOutliers]);

  function updateCell(rowId: string, field: "x" | "y", value: string) {
    graph.set(
      ids.rows,
      rows.map((row) => (row.id === rowId ? { ...row, [field]: value } : row)),
    );
  }

  function addRow() {
    graph.set(ids.rows, [...rows, { id: crypto.randomUUID(), x: "", y: "" }]);
  }

  function removeRow(rowId: string) {
    graph.set(
      ids.rows,
      rows.filter((row) => row.id !== rowId),
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
    <div>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "1rem" }}>
        <label>
          <input
            type="radio"
            checked={fitType === "linear"}
            onChange={() => graph.set(ids.fitType, "linear" as FitType)}
          />{" "}
          Linear
        </label>
        <label>
          <input
            type="radio"
            checked={fitType === "nonlinear"}
            onChange={() => graph.set(ids.fitType, "nonlinear" as FitType)}
          />{" "}
          Nonlinear (custom model)
        </label>
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
            {rows.map((row) => (
              <tr key={row.id}>
                <td style={dataCellStyle}>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    value={row.x}
                    onChange={(e) => updateCell(row.id, "x", e.target.value)}
                    style={{ font: "inherit", width: "8ch", maxWidth: "100%" }}
                  />
                </td>
                <td style={dataCellStyle}>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    value={row.y}
                    onChange={(e) => updateCell(row.id, "y", e.target.value)}
                    style={{ font: "inherit", width: "8ch", maxWidth: "100%" }}
                  />
                </td>
                <td style={dataCellStyle}>
                  <button
                    type="button"
                    onClick={() => removeRow(row.id)}
                    disabled={rows.length <= 1}
                    aria-label="Remove row"
                    title="Remove row"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" onClick={addRow} style={{ margin: "0.5rem 0" }}>
        + Add row
      </button>
      <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} style={{ border: "1px solid var(--border)" }} />
      <div style={{ margin: "0.25rem 0" }}>
        <PngExportButton
          getCanvas={() => canvasRef.current}
          label="regression"
          renderAtScale={(ctx, width, height) => drawRegressionPanel(ctx, width, height, viewport, plot)}
          baseWidth={WIDTH}
          baseHeight={HEIGHT}
        />{" "}
        <SvgExportButton
          getSvg={() => {
            if (!plot) return null;
            return layersToSvgDocument(
              [
                { kind: "scatter", points: plot.scatterPoints },
                ...(plot.curvePath ? [{ kind: "path" as const, path: plot.curvePath }] : []),
                { kind: "scatter", points: plot.outlierPoints, color: "#f59e0b", radius: 7 },
              ],
              viewport,
              WIDTH,
              HEIGHT,
            );
          }}
          label="regression"
        />
      </div>
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
