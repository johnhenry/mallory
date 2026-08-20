import { Distributions, Statistics, Vector } from "mallory-math";
import { addLocalSave } from "../lib/local-saves.ts";
import { useEffect, useRef, useState } from "react";
import { cellIdsStatistics, type CellIdsStatistics } from "../lib/cell-ids.ts";
import { CellGraph } from "../lib/cell-graph.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useUndoHistory } from "../hooks/use-undo-history.ts";
import { appendRow, paletteColor, removeRow } from "../lib/multi-panel-rows.ts";
import {
  DEFAULT_STATISTICS_STATE,
  decodeStatisticsState,
  encodeStatisticsState,
  type StatisticsRowState,
  type StatisticsState,
} from "../lib/statistics-state.ts";
import { HYPOTHESIS_TEST_LABELS, runHypothesisTest, type HypothesisTestResult, type HypothesisTestType } from "../lib/hypothesis-test.ts";
import { buildKernel, residualSeries, smoothSeries, type KernelType, type SmoothedSeries } from "../lib/smoothing.ts";
import { drawAxes, drawPolyline, drawScatter } from "../lib/render-path.ts";
import { layersToSvgDocument, polylineToSvgDocument } from "../lib/svg-export.ts";
import type { Viewport } from "../lib/viewport.ts";
import { useCell } from "../lib/use-cell.ts";
import { PngExportButton } from "./PngExportButton.tsx";
import { SvgExportButton } from "./SvgExportButton.tsx";

type SummaryResult =
  | {
      ok: true;
      count: number;
      mean: number;
      median: number;
      standardDeviation: number;
      variance: number;
      min: number;
      max: number;
      fiveNumberSummary: number[];
    }
  | { ok: false; message: string };

type QueryResult = { ok: true; lowerCdf: number; upperCdf: number; intervalProbability: number } | { ok: false; message: string };

type SmoothingResult = { ok: true; data: number[]; smoothed: SmoothedSeries; residuals: number[] } | { ok: false; message: string };

interface SmoothingPlot {
  viewport: Viewport;
  rawPoints: { x: number; y: number }[];
  smoothedPoints: { x: number; y: number }[];
}

/** Shared by the smoothing canvas's draw effect and its SVG export getter, so the viewport/point math can't drift between the two (issue #45 item 1's "statistics smoothing" example). Still a per-dataset pure function (#336 item 7's unlimited-datasets port): each dataset's own smoothing canvas calls it against its own data/smoothed series. */
export function smoothingPlot(data: number[], smoothed: SmoothedSeries): SmoothingPlot {
  const allY = [...data, ...smoothed.values];
  const minY = Math.min(...allY);
  const maxY = Math.max(...allY);
  const pad = Math.max(1e-9, (maxY - minY) * 0.1);
  return {
    viewport: { xMin: 0, xMax: data.length - 1, yMin: minY - pad, yMax: maxY + pad },
    rawPoints: data.map((y, x) => ({ x, y })),
    smoothedPoints: smoothed.indices.map((idx, i) => ({ x: idx, y: smoothed.values[i]! })),
  };
}

interface ResidualPlot {
  viewport: Viewport;
  points: { x: number; y: number }[];
}

/** Shared by the residual canvas's draw effect and its SVG export getter. Still per-dataset (#336 item 7), same reasoning as `smoothingPlot`. */
export function residualPlot(smoothed: SmoothedSeries, residuals: number[]): ResidualPlot {
  const maxAbs = Math.max(1e-9, ...residuals.map((r) => Math.abs(r)));
  return {
    viewport: { xMin: 0, xMax: smoothed.indices[smoothed.indices.length - 1] ?? 0, yMin: -maxAbs * 1.1, yMax: maxAbs * 1.1 },
    points: smoothed.indices.map((idx, i) => ({ x: idx, y: residuals[i]! })),
  };
}

/**
 * Pure re-render of one dataset's own smoothing canvas, extracted from the
 * draw effect below so `PngExportButton`'s `renderAtScale` (issue #278) can
 * call it against a fresh offscreen canvas at any size. Wraps the already-
 * shared `smoothingPlot()` helper (issue #45 item 1) rather than
 * re-deriving the viewport/point math. `color` (#336 item 7, unlimited
 * datasets) tints the smoothed polyline -- replaces the old hardcoded
 * "#dc2626" so each dataset's own smoothing curve reads distinctly when
 * several datasets are open side by side.
 */
export function drawStatisticsSmoothingPanel(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  smoothingResult: SmoothingResult,
  color = 0xdc2626,
): void {
  ctx.clearRect(0, 0, width, height);
  if (!smoothingResult.ok) return;
  const { viewport, rawPoints, smoothedPoints } = smoothingPlot(smoothingResult.data, smoothingResult.smoothed);
  const hexColor = `#${color.toString(16).padStart(6, "0")}`;
  drawAxes(ctx, viewport, width, height);
  drawScatter(ctx, rawPoints, viewport, width, height, 2.5, "#93c5fd");
  drawPolyline(ctx, smoothedPoints, viewport, width, height, hexColor);
}

/**
 * Pure re-render of one dataset's own residual canvas, extracted from the
 * draw effect below so `PngExportButton`'s `renderAtScale` (issue #278) can
 * call it against a fresh offscreen canvas at any size. Wraps the already-
 * shared `residualPlot()` helper (issue #45 item 1). `color` (#336 item 7)
 * replaces the old hardcoded "#16a34a", same reasoning as
 * `drawStatisticsSmoothingPanel`'s own `color` param.
 */
export function drawStatisticsResidualPanel(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  smoothingResult: SmoothingResult,
  smoothingShowResidual: boolean,
  color = 0x16a34a,
): void {
  ctx.clearRect(0, 0, width, height);
  if (!smoothingShowResidual || !smoothingResult.ok) return;
  const { viewport, points } = residualPlot(smoothingResult.smoothed, smoothingResult.residuals);
  const hexColor = `#${color.toString(16).padStart(6, "0")}`;
  drawAxes(ctx, viewport, width, height);
  drawPolyline(ctx, points, viewport, width, height, hexColor);
}

type DistType = "normal" | "binomial" | "poisson" | "studentT" | "chiSquare";

const DIST_LABELS: Record<DistType, string> = {
  normal: "Normal",
  binomial: "Binomial",
  poisson: "Poisson",
  studentT: "Student's t",
  chiSquare: "Chi-square",
};

export function parseData(text: string): number[] {
  return text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);
}

/**
 * Seeds one dataset's own cells (#336 item 7, unlimited independent
 * datasets): its own data string, distribution type/params, query bounds,
 * color and visibility, plus its own derived summary/query, and its own
 * inference/smoothing auxiliary cells (deliberately NOT part of the
 * persisted StatisticsState/URL-hash schema -- see cellIdsStatistics's own
 * doc comment -- but still seeded here to sane defaults, same convention
 * `useStatisticsGraph` used before this port). Mirrors
 * RegressionPanel/OdePanel's own `seedRegressionDataset`/`seedOdeRow`.
 */
export function seedStatisticsRow(graph: CellGraph, rowId: string, row: StatisticsRowState): void {
  const ids = cellIdsStatistics(rowId);
  graph.set(ids.data, row.data);
  graph.set(ids.distType, row.distType as DistType);
  graph.set(ids.distMean, row.distMean);
  graph.set(ids.distSd, row.distSd);
  graph.set(ids.distN, row.distN);
  graph.set(ids.distP, row.distP);
  graph.set(ids.distLambda, row.distLambda);
  graph.set(ids.distDf, row.distDf);
  graph.set(ids.queryLower, row.queryLower);
  graph.set(ids.queryUpper, row.queryUpper);
  graph.set(ids.color, row.color);
  graph.set(ids.visible, row.visible);

  // Inference-section defaults -- not part of the persisted state schema (see cell-ids.ts's note).
  graph.set(ids.testType, "oneSampleT" satisfies HypothesisTestType, { auxiliary: true });
  graph.set(ids.testMu0, "0", { auxiliary: true });
  graph.set(ids.testDataB, "1, 2, 3, 4, 5", { auxiliary: true });
  graph.set(ids.testExpected, "", { auxiliary: true });
  graph.set(ids.testAlpha, "0.05", { auxiliary: true });

  // Smoothing-section defaults -- same "not part of the persisted state
  // schema" convention as the inference section above.
  graph.set(ids.smoothingKernelType, "moving-average" satisfies KernelType, { auxiliary: true });
  graph.set(ids.smoothingWidth, "5", { auxiliary: true });
  graph.set(ids.smoothingShowResidual, false, { auxiliary: true });

  // Same "surface the real error" deviation SystemSolverPanel uses: this is
  // a discrete action on typed-in text, not a continuous sampling target,
  // so a thrown message is more useful than a stale last-good summary.
  graph.define(ids.summary, (): SummaryResult => {
    try {
      const parsed = parseData(graph.get<string>(ids.data));
      if (parsed.length === 0) throw new Error("Enter at least one number.");
      if (parsed.some(Number.isNaN)) throw new Error("Every entry must be a number.");
      const values = new Vector<number>(...parsed);
      return {
        ok: true,
        count: values.length,
        mean: Statistics.mean(values),
        median: Statistics.median(values),
        standardDeviation: values.length > 1 ? Statistics.standardDeviation(values) : Number.NaN,
        variance: values.length > 1 ? Statistics.variance(values) : Number.NaN,
        min: Statistics.minimum(values),
        max: Statistics.maximum(values),
        fiveNumberSummary: [...Statistics.fiveNumberSummary(values)],
      };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });

  // PDF/CDF at a point isn't shown separately since the interval query
  // below subsumes it (a degenerate [x, x] interval), and there's no
  // interactive draggable-marker axis widget yet (GeoGebra's Probability
  // Calculator UX) -- that's a later extension once this basic
  // numeric-input version is in place. Every Distributions.* factory
  // exposes the same `cdf(x)` shape regardless of continuous/discrete,
  // so the interval-probability math below is identical across every
  // distribution type -- only which factory (and which parameters) gets
  // built differs.
  graph.define(ids.query, (): QueryResult => {
    try {
      const distType = graph.get<DistType>(ids.distType);
      const lower = Number(graph.get<string>(ids.queryLower));
      const upper = Number(graph.get<string>(ids.queryUpper));
      if ([lower, upper].some(Number.isNaN)) throw new Error("Every field must be a number.");
      let dist: { cdf(x: number): number };
      switch (distType) {
        case "normal": {
          const mean = Number(graph.get<string>(ids.distMean));
          const sd = Number(graph.get<string>(ids.distSd));
          if ([mean, sd].some(Number.isNaN)) throw new Error("mean and sd must be numbers.");
          if (sd <= 0) throw new Error("Standard deviation must be positive.");
          dist = Distributions.normal(mean, sd);
          break;
        }
        case "binomial": {
          const n = Number(graph.get<string>(ids.distN));
          const p = Number(graph.get<string>(ids.distP));
          if ([n, p].some(Number.isNaN)) throw new Error("n and p must be numbers.");
          if (!Number.isInteger(n) || n < 0) throw new Error("n must be a non-negative integer.");
          if (p < 0 || p > 1) throw new Error("p must be between 0 and 1.");
          dist = Distributions.binomial(n, p);
          break;
        }
        case "poisson": {
          const lambda = Number(graph.get<string>(ids.distLambda));
          if (Number.isNaN(lambda)) throw new Error("lambda must be a number.");
          if (lambda <= 0) throw new Error("lambda must be positive.");
          dist = Distributions.poisson(lambda);
          break;
        }
        case "studentT": {
          const df = Number(graph.get<string>(ids.distDf));
          if (Number.isNaN(df)) throw new Error("df must be a number.");
          if (df <= 0) throw new Error("df must be positive.");
          dist = Distributions.studentT(df);
          break;
        }
        case "chiSquare": {
          const df = Number(graph.get<string>(ids.distDf));
          if (Number.isNaN(df)) throw new Error("df must be a number.");
          if (df <= 0) throw new Error("df must be positive.");
          dist = Distributions.chiSquare(df);
          break;
        }
      }
      const lowerCdf = dist.cdf(lower);
      const upperCdf = dist.cdf(upper);
      return { ok: true, lowerCdf, upperCdf, intervalProbability: Math.max(0, upperCdf - lowerCdf) };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });

  // Reuses ids.data as the primary/first sample -- the descriptive
  // summary above and the inference test below share one dataset by
  // design, so entering data once feeds both sections.
  graph.define(ids.testResult, (): HypothesisTestResult => {
    try {
      const testType = graph.get<HypothesisTestType>(ids.testType);
      const sample = parseData(graph.get<string>(ids.data));
      if (sample.length === 0 || sample.some(Number.isNaN)) throw new Error("Enter valid data in the Descriptive statistics section above.");
      const alpha = Number(graph.get<string>(ids.testAlpha));
      const mu0 = Number(graph.get<string>(ids.testMu0));
      const sampleB = parseData(graph.get<string>(ids.testDataB));
      const expectedText = graph.get<string>(ids.testExpected).trim();
      const expected = expectedText.length > 0 ? parseData(expectedText) : undefined;
      return runHypothesisTest(testType, { sample, sampleB, mu0, expected, alpha });
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });

  // Reuses ids.data too, same as the inference section above.
  graph.define(ids.smoothingResult, (): SmoothingResult => {
    try {
      const parsedData = parseData(graph.get<string>(ids.data));
      if (parsedData.length === 0 || parsedData.some(Number.isNaN)) throw new Error("Enter valid data in Descriptive statistics above.");
      const kernelType = graph.get<KernelType>(ids.smoothingKernelType);
      const width = Number(graph.get<string>(ids.smoothingWidth));
      const kernel = buildKernel(kernelType, width);
      const smoothed = smoothSeries(parsedData, kernel);
      const residuals = residualSeries(parsedData, smoothed);
      return { ok: true, data: parsedData, smoothed, residuals };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });
}

function seedStatisticsRowDefault(graph: CellGraph, rowId: string, index: number): void {
  seedStatisticsRow(graph, rowId, { ...(DEFAULT_STATISTICS_STATE.rows[0] as StatisticsRowState), color: paletteColor(index) });
}

/**
 * Full re-seed of the container: clears any existing datasets (deleting
 * their cells) and seeds fresh ones from `state.rows` -- same "delete then
 * replay" shape OdePanel's/RegressionPanel's own `seedOdeState`/
 * `seedRegressionState` use, needed because a notebook block's seeding
 * effect runs AFTER `useStatisticsGraph` has already constructed one
 * default dataset.
 */
export function seedStatisticsState(graph: CellGraph, containerIds: CellIdsStatistics, state: StatisticsState): void {
  const existing = graph.has(containerIds.list) ? graph.get<string[]>(containerIds.list) : [];
  for (const rowId of existing) removeRow(graph, containerIds.list, rowId, cellIdsStatistics(rowId));
  const rowIds = state.rows.map(() => crypto.randomUUID());
  graph.set(containerIds.list, rowIds, { auxiliary: true });
  rowIds.forEach((id, i) => seedStatisticsRow(graph, id, state.rows[i] as StatisticsRowState));
}

/** Builds the full serializable state of a statistics panel -- shared by the URL-sync effect and the save-to-gallery handler. */
export function getCurrentStatisticsState(graph: CellGraph, containerIds: CellIdsStatistics): StatisticsState {
  return {
    v: 2,
    rows: graph.get<string[]>(containerIds.list).map((rowId) => {
      const ids = cellIdsStatistics(rowId);
      return {
        data: graph.get<string>(ids.data),
        distType: graph.get<DistType>(ids.distType),
        distMean: graph.get<string>(ids.distMean),
        distSd: graph.get<string>(ids.distSd),
        distN: graph.get<string>(ids.distN),
        distP: graph.get<string>(ids.distP),
        distLambda: graph.get<string>(ids.distLambda),
        distDf: graph.get<string>(ids.distDf),
        queryLower: graph.get<string>(ids.queryLower),
        queryUpper: graph.get<string>(ids.queryUpper),
        color: graph.get<number>(ids.color),
        visible: graph.get<boolean>(ids.visible),
      };
    }),
  };
}

/**
 * Sets up the statistics panel's reactive cells -- an ordered list of
 * fully independent dataset rows (#336 item 7), each with a raw data-value
 * list plus its own distribution-query/inference/smoothing state, a
 * different input shape from GraphCanvas's single expression + axis
 * variable, so (like SystemSolverPanel) it isn't woven into
 * `cellIds`/`useExpressionGraph` at all. Shares an `externalGraph` when
 * supplied instead of creating a private one, mirroring OdePanel's
 * `useOdeGraph`.
 */
function useStatisticsGraph(cellId: string, externalGraph?: CellGraph): CellGraph {
  const ref = useRef<CellGraph | null>(null);
  if (!ref.current) {
    const graph = externalGraph ?? new CellGraph();
    const containerIds = cellIdsStatistics(cellId);
    if (!graph.has(containerIds.list)) {
      graph.set(containerIds.list, [] as string[], { auxiliary: true });
      const decoded = !externalGraph && typeof window !== "undefined" ? decodeStatisticsState(window.location.hash.slice(1)) : null;
      seedStatisticsState(graph, containerIds, decoded ?? DEFAULT_STATISTICS_STATE);
    }
    ref.current = graph;
  }
  return ref.current;
}

const SMOOTHING_WIDTH = 560;
const SMOOTHING_HEIGHT = 200;

/**
 * One dataset's ENTIRE own UI (#336 item 7, unlimited independent
 * datasets): checkbox+color swatch+remove-button header, the full
 * descriptive-statistics/smoothing/distribution-query/hypothesis-test
 * sections this panel has always had, and its own two canvases -- every
 * one of today's sections scoped to `cellIdsStatistics(rowId)` instead of
 * the panel's own single `cellId`. There's no shared plot to overlay
 * datasets on (unlike RegressionPanel/OdeSystemPanel's own multi-row
 * ports) -- each dataset draws its own canvases independently, gated
 * entirely by its own `visible`.
 */
function StatisticsDataset({ graph, rowId, onRemove }: { graph: CellGraph; rowId: string; onRemove?: () => void }) {
  const ids = cellIdsStatistics(rowId);
  const data = useCell<string>(graph, ids.data);
  const summary = useCell<SummaryResult>(graph, ids.summary);
  const distType = useCell<DistType>(graph, ids.distType);
  const distMean = useCell<string>(graph, ids.distMean);
  const distSd = useCell<string>(graph, ids.distSd);
  const distN = useCell<string>(graph, ids.distN);
  const distP = useCell<string>(graph, ids.distP);
  const distLambda = useCell<string>(graph, ids.distLambda);
  const distDf = useCell<string>(graph, ids.distDf);
  const queryLower = useCell<string>(graph, ids.queryLower);
  const queryUpper = useCell<string>(graph, ids.queryUpper);
  const query = useCell<QueryResult>(graph, ids.query);
  const testType = useCell<HypothesisTestType>(graph, ids.testType);
  const testMu0 = useCell<string>(graph, ids.testMu0);
  const testDataB = useCell<string>(graph, ids.testDataB);
  const testExpected = useCell<string>(graph, ids.testExpected);
  const testAlpha = useCell<string>(graph, ids.testAlpha);
  const testResult = useCell<HypothesisTestResult>(graph, ids.testResult);
  const smoothingKernelType = useCell<KernelType>(graph, ids.smoothingKernelType);
  const smoothingWidth = useCell<string>(graph, ids.smoothingWidth);
  const smoothingShowResidual = useCell<boolean>(graph, ids.smoothingShowResidual);
  const smoothingResult = useCell<SmoothingResult>(graph, ids.smoothingResult);
  const color = useCell<number>(graph, ids.color);
  const visible = useCell<boolean>(graph, ids.visible);
  const smoothingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const residualCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [dataInput, setDataInput] = useState(data);
  // Keeps the input box in sync when `data` changes for a reason other than
  // typing in this box -- e.g. URL-hash hydration -- mirrors GraphCanvas's
  // identically-reasoned effect.
  useEffect(() => {
    setDataInput(data);
  }, [data]);

  function updateData(value: string) {
    setDataInput(value);
    graph.set(ids.data, value);
  }

  useEffect(() => {
    const ctx = smoothingCanvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawStatisticsSmoothingPanel(ctx, SMOOTHING_WIDTH, SMOOTHING_HEIGHT, smoothingResult, color);
  }, [smoothingResult, color]);

  useEffect(() => {
    const ctx = residualCanvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawStatisticsResidualPanel(ctx, SMOOTHING_WIDTH, SMOOTHING_HEIGHT, smoothingResult, smoothingShowResidual, color);
  }, [smoothingResult, smoothingShowResidual, color]);

  if (!visible) {
    return (
      <div style={{ margin: "0.35rem 0", padding: "0.35rem", border: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
          <input type="checkbox" checked={visible} onChange={(e) => graph.set(ids.visible, e.target.checked)} title="Show/hide this dataset" />
          <input
            type="color"
            value={`#${color.toString(16).padStart(6, "0")}`}
            onChange={(e) => graph.set(ids.color, Number.parseInt(e.target.value.slice(1), 16))}
          />
          <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Hidden</span>
          {onRemove && (
            <button type="button" onClick={onRemove} title="Remove this dataset">
              ✕
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ margin: "0.35rem 0", padding: "0.35rem", border: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
        <input type="checkbox" checked={visible} onChange={(e) => graph.set(ids.visible, e.target.checked)} title="Show/hide this dataset" />
        <input
          type="color"
          value={`#${color.toString(16).padStart(6, "0")}`}
          onChange={(e) => graph.set(ids.color, Number.parseInt(e.target.value.slice(1), 16))}
        />
        {onRemove && (
          <button type="button" onClick={onRemove} title="Remove this dataset">
            ✕
          </button>
        )}
      </div>

      <h2>Descriptive statistics</h2>
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          Data (comma or space separated):{" "}
          <input value={dataInput} onChange={(e) => updateData(e.target.value)} style={{ font: "inherit", width: "40ch" }} />
        </label>
      </div>
      <div style={{ margin: "0.5rem 0" }}>
        {summary.ok ? (
          <ul>
            <li>n = {summary.count}</li>
            <li>mean = {summary.mean.toFixed(4)}</li>
            <li>median = {summary.median.toFixed(4)}</li>
            <li>standard deviation = {Number.isNaN(summary.standardDeviation) ? "n/a (n<2)" : summary.standardDeviation.toFixed(4)}</li>
            <li>variance = {Number.isNaN(summary.variance) ? "n/a (n<2)" : summary.variance.toFixed(4)}</li>
            <li>
              min / max = {summary.min.toFixed(4)} / {summary.max.toFixed(4)}
            </li>
            <li>five-number summary = [{summary.fiveNumberSummary.map((v) => v.toFixed(4)).join(", ")}]</li>
          </ul>
        ) : (
          <p style={{ color: "var(--danger)" }}>{summary.message}</p>
        )}
      </div>

      <h2>Smoothing</h2>
      <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>Uses the data entered in Descriptive statistics above, in entry order.</p>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <label>
          Kernel:{" "}
          <select value={smoothingKernelType} onChange={(e) => graph.set(ids.smoothingKernelType, e.target.value as KernelType)}>
            <option value="moving-average">Moving average</option>
            <option value="gaussian">Gaussian</option>
          </select>
        </label>
        <label>
          width (odd):{" "}
          <input
            type="number"
            min={1}
            step={2}
            value={smoothingWidth}
            onChange={(e) => graph.set(ids.smoothingWidth, e.target.value)}
            style={{ font: "inherit", width: "6ch" }}
          />
        </label>
        <label>
          <input type="checkbox" checked={smoothingShowResidual} onChange={(e) => graph.set(ids.smoothingShowResidual, e.target.checked)} /> show
          residual (raw − smoothed)
        </label>
      </div>
      {!smoothingResult.ok ? (
        <p style={{ color: "var(--danger)" }}>{smoothingResult.message}</p>
      ) : (
        <p style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
          Blue dots = raw data, colored line = smoothed. The first/last{" "}
          {Math.floor((smoothingResult.data.length - smoothingResult.smoothed.indices.length) / 2)} point(s) at each edge are trimmed (a
          "same"-mode convolution boundary sample there averages against zero-padding, not real neighboring data).
        </p>
      )}
      <canvas ref={smoothingCanvasRef} width={SMOOTHING_WIDTH} height={SMOOTHING_HEIGHT} style={{ border: "1px solid var(--border)", maxWidth: "100%" }} />
      <div style={{ margin: "0.25rem 0" }}>
        <PngExportButton
          getCanvas={() => smoothingCanvasRef.current}
          label="statistics-smoothing"
          renderAtScale={(ctx, width, height) => drawStatisticsSmoothingPanel(ctx, width, height, smoothingResult, color)}
          baseWidth={SMOOTHING_WIDTH}
          baseHeight={SMOOTHING_HEIGHT}
        />{" "}
        <SvgExportButton
          getSvg={() => {
            if (!smoothingResult.ok) return null;
            const { viewport, rawPoints, smoothedPoints } = smoothingPlot(smoothingResult.data, smoothingResult.smoothed);
            const hexColor = `#${color.toString(16).padStart(6, "0")}`;
            return layersToSvgDocument(
              [
                { kind: "scatter", points: rawPoints, color: "#93c5fd", radius: 2.5 },
                { kind: "polyline", points: smoothedPoints, color: hexColor },
              ],
              viewport,
              SMOOTHING_WIDTH,
              SMOOTHING_HEIGHT,
            );
          }}
          label="statistics-smoothing"
        />
      </div>
      {smoothingShowResidual && (
        <>
          <canvas
            ref={residualCanvasRef}
            width={SMOOTHING_WIDTH}
            height={SMOOTHING_HEIGHT}
            style={{ border: "1px solid var(--border)", maxWidth: "100%", marginTop: "0.5rem" }}
          />
          <div style={{ margin: "0.25rem 0" }}>
            <PngExportButton
              getCanvas={() => residualCanvasRef.current}
              label="statistics-residual"
              renderAtScale={(ctx, width, height) => drawStatisticsResidualPanel(ctx, width, height, smoothingResult, smoothingShowResidual, color)}
              baseWidth={SMOOTHING_WIDTH}
              baseHeight={SMOOTHING_HEIGHT}
            />{" "}
            <SvgExportButton
              getSvg={() => {
                if (!smoothingResult.ok) return null;
                const { viewport, points } = residualPlot(smoothingResult.smoothed, smoothingResult.residuals);
                const hexColor = `#${color.toString(16).padStart(6, "0")}`;
                return polylineToSvgDocument(points, viewport, SMOOTHING_WIDTH, SMOOTHING_HEIGHT, hexColor);
              }}
              label="statistics-residual"
            />
          </div>
        </>
      )}

      <h2>Distribution</h2>
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          Distribution:{" "}
          <select value={distType} onChange={(e) => graph.set(ids.distType, e.target.value as DistType)}>
            {(Object.keys(DIST_LABELS) as DistType[]).map((t) => (
              <option key={t} value={t}>
                {DIST_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        {distType === "normal" && (
          <>
            <label>
              mean: <input value={distMean} onChange={(e) => graph.set(ids.distMean, e.target.value)} style={{ font: "inherit", width: "8ch" }} />
            </label>
            <label>
              sd: <input value={distSd} onChange={(e) => graph.set(ids.distSd, e.target.value)} style={{ font: "inherit", width: "8ch" }} />
            </label>
          </>
        )}
        {distType === "binomial" && (
          <>
            <label>
              n: <input value={distN} onChange={(e) => graph.set(ids.distN, e.target.value)} style={{ font: "inherit", width: "8ch" }} />
            </label>
            <label>
              p: <input value={distP} onChange={(e) => graph.set(ids.distP, e.target.value)} style={{ font: "inherit", width: "8ch" }} />
            </label>
          </>
        )}
        {distType === "poisson" && (
          <label>
            λ: <input value={distLambda} onChange={(e) => graph.set(ids.distLambda, e.target.value)} style={{ font: "inherit", width: "8ch" }} />
          </label>
        )}
        {(distType === "studentT" || distType === "chiSquare") && (
          <label>
            df: <input value={distDf} onChange={(e) => graph.set(ids.distDf, e.target.value)} style={{ font: "inherit", width: "8ch" }} />
          </label>
        )}
      </div>
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          P(
          <input value={queryLower} onChange={(e) => graph.set(ids.queryLower, e.target.value)} style={{ font: "inherit", width: "6ch" }} /> ≤ X ≤{" "}
          <input value={queryUpper} onChange={(e) => graph.set(ids.queryUpper, e.target.value)} style={{ font: "inherit", width: "6ch" }} />)
        </label>
      </div>
      <div style={{ margin: "0.5rem 0" }}>
        {query.ok ? (
          <p>
            = {query.intervalProbability.toFixed(6)} (CDF({queryUpper}) = {query.upperCdf.toFixed(6)}, CDF({queryLower}) = {query.lowerCdf.toFixed(6)})
          </p>
        ) : (
          <p style={{ color: "var(--danger)" }}>{query.message}</p>
        )}
      </div>
      <h2>Inference</h2>
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          Test:{" "}
          <select value={testType} onChange={(e) => graph.set(ids.testType, e.target.value as HypothesisTestType)}>
            {(Object.keys(HYPOTHESIS_TEST_LABELS) as HypothesisTestType[]).map((t) => (
              <option key={t} value={t}>
                {HYPOTHESIS_TEST_LABELS[t]}
              </option>
            ))}
          </select>
        </label>{" "}
        <label>
          α: <input value={testAlpha} onChange={(e) => graph.set(ids.testAlpha, e.target.value)} style={{ font: "inherit", width: "6ch" }} />
        </label>
      </div>
      <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>Uses the data entered in Descriptive statistics above as the (first) sample.</p>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        {testType === "oneSampleT" && (
          <label>
            μ₀: <input value={testMu0} onChange={(e) => graph.set(ids.testMu0, e.target.value)} style={{ font: "inherit", width: "8ch" }} />
          </label>
        )}
        {testType === "twoSampleT" && (
          <label>
            Second sample:{" "}
            <input value={testDataB} onChange={(e) => graph.set(ids.testDataB, e.target.value)} style={{ font: "inherit", width: "30ch" }} />
          </label>
        )}
        {testType === "chiSquareGoF" && (
          <label>
            Expected frequencies:{" "}
            <input value={testExpected} onChange={(e) => graph.set(ids.testExpected, e.target.value)} style={{ font: "inherit", width: "30ch" }} />
          </label>
        )}
      </div>
      <div style={{ margin: "0.5rem 0" }}>
        {testResult.ok ? (
          testResult.testType === "confidenceInterval" ? (
            <p>
              {(Number(testAlpha) > 0 ? (1 - Number(testAlpha)) * 100 : 95).toFixed(0)}% CI for the mean: [{testResult.interval[0].toFixed(4)},{" "}
              {testResult.interval[1].toFixed(4)}]
            </p>
          ) : (
            <p>
              statistic = {testResult.result.statistic.toFixed(4)}, df = {testResult.result.df.toFixed(2)}, p = {testResult.result.pValue.toFixed(6)}
              <br />
              {testResult.verdict}
            </p>
          )
        ) : (
          <p style={{ color: "var(--danger)" }}>{testResult.message}</p>
        )}
      </div>
    </div>
  );
}

export interface StatisticsPanelProps {
  cellId?: string;
  /** Share an existing CellGraph (e.g. from a notebook block) instead of creating a private one. */
  graph?: CellGraph;
  /** Hydrate from and write to the URL fragment. Off for a notebook-embedded instance, whose document owns persistence instead. */
  syncUrl?: boolean;
}

/**
 * Descriptive statistics for an entered dataset, plus an interval-
 * probability calculator over any of five distributions, a hypothesis-test
 * section, and a kernel-smoothing section -- over unlimited independent
 * datasets (#336 item 7). Unlike RegressionPanel/OdeSystemPanel's own
 * multi-row ports, there's no natural shared plot to overlay datasets on
 * here: each dataset is its own fully self-contained copy of the panel's
 * entire state and UI (own data string, own distribution/query/hypothesis-
 * test/smoothing state, own two canvases) -- see `StatisticsDataset`.
 * Nothing meaningful stays container-level except the ordered row-id list
 * itself.
 */
export function StatisticsPanel({ cellId = "statistics-1", graph: externalGraph, syncUrl = true }: StatisticsPanelProps = {}) {
  const graph = useStatisticsGraph(cellId, externalGraph);
  // Namespaced by cellId, same collision-avoidance fix as OdePanel's.
  useCellGraphTools(`data_statistics_${cellId}`, graph);
  const containerIds = cellIdsStatistics(cellId);
  const rowIds = useCell<string[]>(graph, containerIds.list);

  // Standalone only (issue #43, same enabled:syncUrl pattern as RegressionPanel's #121 adoption):
  // a notebook-embedded instance shares its graph with NotebookPanel's own useUndoHistory, so a
  // second independent history here would double-fire on Ctrl+Z.
  const history = useUndoHistory(
    graph,
    () => getCurrentStatisticsState(graph, containerIds),
    (state) => seedStatisticsState(graph, containerIds, state),
    250,
    undefined,
    syncUrl,
  );

  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  function addDataset() {
    const { id, index } = appendRow(graph, containerIds.list);
    seedStatisticsRowDefault(graph, id, index);
  }

  function removeDataset(rowId: string) {
    removeRow(graph, containerIds.list, rowId, cellIdsStatistics(rowId));
  }

  async function handleSave() {
    const title = window.prompt("Title for this saved statistics setup:", "Untitled");
    if (title === null) return;
    try {
      addLocalSave({ title, kind: "statistics", state: getCurrentStatisticsState(graph, containerIds) });
      setSaveStatus(`Saved as "${title || "Untitled"}" to My saves on this device — reopen or publish it from the gallery.`);
    } catch (e) {
      setSaveStatus(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Keep the URL fragment in sync with the live graph state, mirroring OdePanel's pattern.
  useEffect(() => {
    if (!syncUrl) return;
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeStatisticsState(getCurrentStatisticsState(graph, containerIds))}`);
    }
    writeUrl();
    return graph.subscribeAll(writeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, syncUrl]);

  return (
    <div>
      {rowIds.map((rowId) => (
        <StatisticsDataset key={rowId} graph={graph} rowId={rowId} onRemove={rowIds.length > 1 ? () => removeDataset(rowId) : undefined} />
      ))}
      <button type="button" onClick={addDataset} style={{ margin: "0.35rem 0" }}>
        + Add dataset
      </button>
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
