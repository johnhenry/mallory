import { Distributions, Statistics, Vector } from "mallory-math";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { cellIdsStatistics, type CellIdsStatistics } from "../lib/cell-ids.ts";
import { CellGraph } from "../lib/cell-graph.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import {
  DEFAULT_STATISTICS_STATE,
  decodeStatisticsState,
  encodeStatisticsState,
  type StatisticsState,
} from "../lib/statistics-state.ts";
import { HYPOTHESIS_TEST_LABELS, runHypothesisTest, type HypothesisTestResult, type HypothesisTestType } from "../lib/hypothesis-test.ts";
import { buildKernel, residualSeries, smoothSeries, type KernelType, type SmoothedSeries } from "../lib/smoothing.ts";
import { drawPolyline, drawScatter } from "../lib/render-path.ts";
import type { Viewport } from "../lib/viewport.ts";
import { saveGraph } from "../lib/saved-graphs.ts";
import { useCell } from "../lib/use-cell.ts";

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

/** Writes a state's fields onto `graph`'s free cells -- shared by useStatisticsGraph's own hydrate-from-hash and a notebook block's post-mount overwrite. */
export function seedStatisticsState(graph: CellGraph, ids: CellIdsStatistics, state: StatisticsState): void {
  graph.set(ids.data, state.data);
  graph.set(ids.distType, state.distType as DistType);
  graph.set(ids.distMean, state.distMean);
  graph.set(ids.distSd, state.distSd);
  graph.set(ids.distN, state.distN);
  graph.set(ids.distP, state.distP);
  graph.set(ids.distLambda, state.distLambda);
  graph.set(ids.distDf, state.distDf);
  graph.set(ids.queryLower, state.queryLower);
  graph.set(ids.queryUpper, state.queryUpper);
}

/** Builds the full serializable state of a statistics panel -- shared by the URL-sync effect and the save-to-gallery handler. */
export function getCurrentStatisticsState(graph: CellGraph, ids: CellIdsStatistics): StatisticsState {
  return {
    v: 1,
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
  };
}

/**
 * Sets up the statistics panel's reactive cells -- a raw data-value list
 * plus separate distribution-query parameters, a different input shape from
 * GraphCanvas's single expression + axis variable, so (like
 * SystemSolverPanel) it isn't woven into `cellIds`/`useExpressionGraph` at
 * all. Shares an `externalGraph` when supplied instead of creating a private
 * one, mirroring OdePanel's `useOdeGraph`.
 */
function useStatisticsGraph(cellId: string, externalGraph?: CellGraph): CellGraph {
  const ref = useRef<CellGraph | null>(null);
  if (!ref.current) {
    const graph = externalGraph ?? new CellGraph();
    const ids = cellIdsStatistics(cellId);
    if (!graph.has(ids.data)) {
      const decoded = !externalGraph && typeof window !== "undefined" ? decodeStatisticsState(window.location.hash.slice(1)) : null;
      seedStatisticsState(graph, ids, decoded ?? DEFAULT_STATISTICS_STATE);

      // Inference-section defaults -- not part of the persisted state schema (see cell-ids.ts's note).
      graph.set(ids.testType, "oneSampleT" satisfies HypothesisTestType);
      graph.set(ids.testMu0, "0");
      graph.set(ids.testDataB, "1, 2, 3, 4, 5");
      graph.set(ids.testExpected, "");
      graph.set(ids.testAlpha, "0.05");

      // Smoothing-section defaults -- not part of the persisted state
      // schema (same convention as the inference section above).
      graph.set(ids.smoothingKernelType, "moving-average" satisfies KernelType);
      graph.set(ids.smoothingWidth, "5");
      graph.set(ids.smoothingShowResidual, false);

      // Same "surface the real error" deviation SystemSolverPanel uses:
      // this is a discrete action on typed-in text, not a continuous
      // sampling target, so a thrown message is more useful than a stale
      // last-good summary.
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
    ref.current = graph;
  }
  return ref.current;
}

export interface StatisticsPanelProps {
  cellId?: string;
  /** Share an existing CellGraph (e.g. from a notebook block) instead of creating a private one. */
  graph?: CellGraph;
  /** Hydrate from and write to the URL fragment. Off for a notebook-embedded instance, whose document owns persistence instead. */
  syncUrl?: boolean;
}

/** v1: descriptive statistics for an entered dataset, plus an interval-probability calculator over any of five distributions. */
export function StatisticsPanel({ cellId = "statistics-1", graph: externalGraph, syncUrl = true }: StatisticsPanelProps = {}) {
  const graph = useStatisticsGraph(cellId, externalGraph);
  // Namespaced by cellId, same collision-avoidance fix as OdePanel's.
  useCellGraphTools(`data_statistics_${cellId}`, graph);
  const ids = cellIdsStatistics(cellId);
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
  const smoothingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const residualCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [dataInput, setDataInput] = useState(data);
  // Keeps the input box in sync when `data` changes for a reason other than
  // typing in this box -- e.g. URL-hash hydration -- mirrors GraphCanvas's
  // identically-reasoned effect.
  useEffect(() => {
    setDataInput(data);
  }, [data]);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const saveGraphFn = useServerFn(saveGraph);

  async function handleSave() {
    const title = window.prompt("Title for this saved statistics setup:", "Untitled");
    if (title === null) return;
    setSaveStatus("Saving…");
    try {
      await saveGraphFn({ data: { title, kind: "statistics", state: getCurrentStatisticsState(graph, ids) } });
      setSaveStatus(`Saved as "${title || "Untitled"}" — see the gallery to reopen it.`);
    } catch (e) {
      setSaveStatus(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Keep the URL fragment in sync with the live graph state, mirroring OdePanel's pattern.
  useEffect(() => {
    if (!syncUrl) return;
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeStatisticsState(getCurrentStatisticsState(graph, ids))}`);
    }
    writeUrl();
    return graph.subscribeAll(writeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, syncUrl]);

  function updateData(value: string) {
    setDataInput(value);
    graph.set(ids.data, value);
  }

  const SMOOTHING_WIDTH = 560;
  const SMOOTHING_HEIGHT = 200;

  useEffect(() => {
    const canvas = smoothingCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, SMOOTHING_WIDTH, SMOOTHING_HEIGHT);
    if (!smoothingResult.ok) return;
    const { data: rawData, smoothed } = smoothingResult;
    const allY = [...rawData, ...smoothed.values];
    const minY = Math.min(...allY);
    const maxY = Math.max(...allY);
    const pad = Math.max(1e-9, (maxY - minY) * 0.1);
    const viewport: Viewport = { xMin: 0, xMax: rawData.length - 1, yMin: minY - pad, yMax: maxY + pad };
    const rawPoints = rawData.map((y, x) => ({ x, y }));
    drawScatter(ctx, rawPoints, viewport, SMOOTHING_WIDTH, SMOOTHING_HEIGHT, 2.5, "#93c5fd");
    const smoothedPoints = smoothed.indices.map((idx, i) => ({ x: idx, y: smoothed.values[i]! }));
    drawPolyline(ctx, smoothedPoints, viewport, SMOOTHING_WIDTH, SMOOTHING_HEIGHT, "#dc2626");
  }, [smoothingResult]);

  useEffect(() => {
    const canvas = residualCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, SMOOTHING_WIDTH, SMOOTHING_HEIGHT);
    if (!smoothingShowResidual || !smoothingResult.ok) return;
    const { smoothed, residuals } = smoothingResult;
    const maxAbs = Math.max(1e-9, ...residuals.map((r) => Math.abs(r)));
    const viewport: Viewport = { xMin: 0, xMax: smoothed.indices[smoothed.indices.length - 1] ?? 0, yMin: -maxAbs * 1.1, yMax: maxAbs * 1.1 };
    const points = smoothed.indices.map((idx, i) => ({ x: idx, y: residuals[i]! }));
    drawPolyline(ctx, points, viewport, SMOOTHING_WIDTH, SMOOTHING_HEIGHT, "#16a34a");
  }, [smoothingResult, smoothingShowResidual]);

  return (
    <div>
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
            <li>min / max = {summary.min.toFixed(4)} / {summary.max.toFixed(4)}</li>
            <li>five-number summary = [{summary.fiveNumberSummary.map((v) => v.toFixed(4)).join(", ")}]</li>
          </ul>
        ) : (
          <p style={{ color: "crimson" }}>{summary.message}</p>
        )}
      </div>

      <h2>Smoothing</h2>
      <p style={{ fontSize: "0.85rem", color: "#5b6b8c", margin: "0.25rem 0" }}>Uses the data entered in Descriptive statistics above, in entry order.</p>
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
          <input
            type="checkbox"
            checked={smoothingShowResidual}
            onChange={(e) => graph.set(ids.smoothingShowResidual, e.target.checked)}
          />{" "}
          show residual (raw − smoothed)
        </label>
      </div>
      {!smoothingResult.ok ? (
        <p style={{ color: "crimson" }}>{smoothingResult.message}</p>
      ) : (
        <p style={{ fontSize: "0.8rem", color: "#5b6b8c" }}>
          Blue dots = raw data, red line = smoothed. The first/last {Math.floor((smoothingResult.data.length - smoothingResult.smoothed.indices.length) / 2)}{" "}
          point(s) at each edge are trimmed (a "same"-mode convolution boundary sample there averages against zero-padding, not real neighboring data).
        </p>
      )}
      <canvas ref={smoothingCanvasRef} width={SMOOTHING_WIDTH} height={SMOOTHING_HEIGHT} style={{ border: "1px solid var(--border)", maxWidth: "100%" }} />
      {smoothingShowResidual && (
        <canvas ref={residualCanvasRef} width={SMOOTHING_WIDTH} height={SMOOTHING_HEIGHT} style={{ border: "1px solid var(--border)", maxWidth: "100%", marginTop: "0.5rem" }} />
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
              mean:{" "}
              <input
                value={distMean}
                onChange={(e) => graph.set(ids.distMean, e.target.value)}
                style={{ font: "inherit", width: "8ch" }}
              />
            </label>
            <label>
              sd:{" "}
              <input
                value={distSd}
                onChange={(e) => graph.set(ids.distSd, e.target.value)}
                style={{ font: "inherit", width: "8ch" }}
              />
            </label>
          </>
        )}
        {distType === "binomial" && (
          <>
            <label>
              n:{" "}
              <input
                value={distN}
                onChange={(e) => graph.set(ids.distN, e.target.value)}
                style={{ font: "inherit", width: "8ch" }}
              />
            </label>
            <label>
              p:{" "}
              <input
                value={distP}
                onChange={(e) => graph.set(ids.distP, e.target.value)}
                style={{ font: "inherit", width: "8ch" }}
              />
            </label>
          </>
        )}
        {distType === "poisson" && (
          <label>
            λ:{" "}
            <input
              value={distLambda}
              onChange={(e) => graph.set(ids.distLambda, e.target.value)}
              style={{ font: "inherit", width: "8ch" }}
            />
          </label>
        )}
        {(distType === "studentT" || distType === "chiSquare") && (
          <label>
            df:{" "}
            <input
              value={distDf}
              onChange={(e) => graph.set(ids.distDf, e.target.value)}
              style={{ font: "inherit", width: "8ch" }}
            />
          </label>
        )}
      </div>
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          P(
          <input
            value={queryLower}
            onChange={(e) => graph.set(ids.queryLower, e.target.value)}
            style={{ font: "inherit", width: "6ch" }}
          />{" "}
          ≤ X ≤{" "}
          <input
            value={queryUpper}
            onChange={(e) => graph.set(ids.queryUpper, e.target.value)}
            style={{ font: "inherit", width: "6ch" }}
          />
          )
        </label>
      </div>
      <div style={{ margin: "0.5rem 0" }}>
        {query.ok ? (
          <p>
            = {query.intervalProbability.toFixed(6)} (CDF({queryUpper}) = {query.upperCdf.toFixed(6)}, CDF({queryLower}) ={" "}
            {query.lowerCdf.toFixed(6)})
          </p>
        ) : (
          <p style={{ color: "crimson" }}>{query.message}</p>
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
          α:{" "}
          <input value={testAlpha} onChange={(e) => graph.set(ids.testAlpha, e.target.value)} style={{ font: "inherit", width: "6ch" }} />
        </label>
      </div>
      <p style={{ fontSize: "0.85rem", color: "#5b6b8c", margin: "0.25rem 0" }}>Uses the data entered in Descriptive statistics above as the (first) sample.</p>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        {testType === "oneSampleT" && (
          <label>
            μ₀:{" "}
            <input value={testMu0} onChange={(e) => graph.set(ids.testMu0, e.target.value)} style={{ font: "inherit", width: "8ch" }} />
          </label>
        )}
        {testType === "twoSampleT" && (
          <label>
            Second sample:{" "}
            <input
              value={testDataB}
              onChange={(e) => graph.set(ids.testDataB, e.target.value)}
              style={{ font: "inherit", width: "30ch" }}
            />
          </label>
        )}
        {testType === "chiSquareGoF" && (
          <label>
            Expected frequencies:{" "}
            <input
              value={testExpected}
              onChange={(e) => graph.set(ids.testExpected, e.target.value)}
              style={{ font: "inherit", width: "30ch" }}
            />
          </label>
        )}
      </div>
      <div style={{ margin: "0.5rem 0" }}>
        {testResult.ok ? (
          testResult.testType === "confidenceInterval" ? (
            <p>
              {(Number(testAlpha) > 0 ? (1 - Number(testAlpha)) * 100 : 95).toFixed(0)}% CI for the mean: [{testResult.interval[0].toFixed(4)}, {testResult.interval[1].toFixed(4)}]
            </p>
          ) : (
            <p>
              statistic = {testResult.result.statistic.toFixed(4)}, df = {testResult.result.df.toFixed(2)}, p = {testResult.result.pValue.toFixed(6)}
              <br />
              {testResult.verdict}
            </p>
          )
        ) : (
          <p style={{ color: "crimson" }}>{testResult.message}</p>
        )}
      </div>
      {syncUrl && (
        <div style={{ margin: "0.5rem 0" }}>
          <button type="button" onClick={handleSave}>
            Save to gallery
          </button>
          {saveStatus && <p style={{ fontSize: "0.85rem", color: "#5b6b8c", margin: "0.25rem 0" }}>{saveStatus}</p>}
        </div>
      )}
    </div>
  );
}
