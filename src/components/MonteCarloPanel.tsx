import type { Path2D } from "mallory-math";
import { useEffect, useRef, useState } from "react";
import { Rng } from "mallory-tensor-core";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsMonteCarlo, type CellIdsMonteCarlo } from "../lib/cell-ids.ts";
import { drawAxes, drawHistogram, drawPath, drawPolyline, drawScatter, type Viewport } from "../lib/render-path.ts";
import { toScreenX, toScreenY } from "../lib/viewport.ts";
import {
  estimateDartPi,
  estimateMonteCarloIntegral,
  sampleDistributionHistogram,
  type DartPiResult,
  type DistributionSampleResult,
  type MonteCarloDistType,
  type MonteCarloIntegrationResult,
} from "../lib/monte-carlo.ts";
import { DEFAULT_MONTE_CARLO_STATE, decodeMonteCarloState, encodeMonteCarloState, type MonteCarloState } from "../lib/monte-carlo-state.ts";
import { layersToSvgDocument, type SvgLayer } from "../lib/svg-export.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useCell } from "../lib/use-cell.ts";
import { PngExportButton } from "./PngExportButton.tsx";
import { SvgExportButton } from "./SvgExportButton.tsx";

const WIDTH = 400;
const HEIGHT = 400;

const DIST_LABELS: Record<MonteCarloDistType, string> = {
  normal: "Normal",
  uniform: "Uniform",
  exponential: "Exponential",
  binomial: "Binomial",
  poisson: "Poisson",
};

function seedMonteCarloState(graph: CellGraph, ids: CellIdsMonteCarlo, state: MonteCarloState): void {
  graph.set(ids.seed, state.seed);
  graph.set(ids.dartCount, state.dartCount);
  graph.set(ids.distType, state.distType);
  graph.set(ids.distMean, state.distMean);
  graph.set(ids.distSd, state.distSd);
  graph.set(ids.distA, state.distA);
  graph.set(ids.distB, state.distB);
  graph.set(ids.distRate, state.distRate);
  graph.set(ids.distN, state.distN);
  graph.set(ids.distP, state.distP);
  graph.set(ids.distLambda, state.distLambda);
  graph.set(ids.sampleCount, state.sampleCount);
  graph.set(ids.integrandText, state.integrandText);
  graph.set(ids.integrandA, state.integrandA);
  graph.set(ids.integrandB, state.integrandB);
  graph.set(ids.integrandSampleCount, state.integrandSampleCount);
}

function getCurrentMonteCarloState(graph: CellGraph, ids: CellIdsMonteCarlo): MonteCarloState {
  return {
    v: 2,
    seed: graph.get<string>(ids.seed),
    dartCount: graph.get<string>(ids.dartCount),
    distType: graph.get<MonteCarloDistType>(ids.distType),
    distMean: graph.get<string>(ids.distMean),
    distSd: graph.get<string>(ids.distSd),
    distA: graph.get<string>(ids.distA),
    distB: graph.get<string>(ids.distB),
    distRate: graph.get<string>(ids.distRate),
    distN: graph.get<string>(ids.distN),
    distP: graph.get<string>(ids.distP),
    distLambda: graph.get<string>(ids.distLambda),
    sampleCount: graph.get<string>(ids.sampleCount),
    integrandText: graph.get<string>(ids.integrandText),
    integrandA: graph.get<string>(ids.integrandA),
    integrandB: graph.get<string>(ids.integrandB),
    integrandSampleCount: graph.get<string>(ids.integrandSampleCount),
  };
}

type DartResult = { ok: true; result: DartPiResult } | { ok: false; message: string };
type HistResult = { ok: true; result: DistributionSampleResult } | { ok: false; message: string };
type IntegrandResult = { ok: true; result: MonteCarloIntegrationResult } | { ok: false; message: string };

export interface DartPlot {
  viewport: Viewport;
  insidePoints: Array<{ x: number; y: number }>;
  outsidePoints: Array<{ x: number; y: number }>;
}

/** Shared between the dart-throw canvas's draw effect and its SVG export, so the two can't drift (issue #45). */
export function dartPlot(dartResult: DartResult): DartPlot | null {
  if (!dartResult.ok) return null;
  return {
    viewport: { xMin: -1, xMax: 1, yMin: -1, yMax: 1 },
    insidePoints: dartResult.result.points.filter((p) => p.inside).map((p) => ({ x: p.x, y: p.y })),
    outsidePoints: dartResult.result.points.filter((p) => !p.inside).map((p) => ({ x: p.x, y: p.y })),
  };
}

export interface ConvergencePlot {
  viewport: Viewport;
  points: Array<{ x: number; y: number }>;
  /** null when pi falls entirely outside the viewport's y-range -- no reference line to draw. */
  piReferenceLine: Array<{ x: number; y: number }> | null;
}

/** Shared between the convergence canvas's draw effect and its SVG export (issue #45). */
export function convergencePlot(dartResult: DartResult): ConvergencePlot | null {
  if (!dartResult.ok || dartResult.result.convergence.length === 0) return null;
  const viewport: Viewport = { xMin: 0, xMax: dartResult.result.n, yMin: 2.5, yMax: 4 };
  const points = dartResult.result.convergence.map((c) => ({ x: c.n, y: c.estimate }));
  const piInRange = !(viewport.yMax - Math.PI < 0 || Math.PI < viewport.yMin);
  return {
    viewport,
    points,
    piReferenceLine: piInRange
      ? [
          { x: viewport.xMin, y: Math.PI },
          { x: viewport.xMax, y: Math.PI },
        ]
      : null,
  };
}

export interface HistogramPlot {
  viewport: Viewport;
  bins: ReadonlyArray<{ x0: number; x1: number; count: number }>;
  /** The density curve rescaled into count-space (an approximation, not a properly normalized dual-axis overlay -- see the inline comment this was extracted from). */
  densityPath: Path2D;
}

/** Shared between the histogram canvas's draw effect and its SVG export (issue #45). */
export function histogramPlot(histResult: HistResult): HistogramPlot | null {
  if (!histResult.ok) return null;
  const { bins, densityPath } = histResult.result;
  const maxCount = Math.max(...bins.map((b) => b.count), 1);
  const minX = bins[0]?.x0 ?? 0;
  const maxX = bins[bins.length - 1]?.x1 ?? 1;
  const viewport: Viewport = { xMin: minX, xMax: maxX, yMin: 0, yMax: maxCount };
  const maxDensity = Math.max(...densityPath.commands.map((c) => c.y), 1e-9);
  const scaledDensityPath = { ...densityPath, commands: densityPath.commands.map((c) => ({ ...c, y: (c.y / maxDensity) * maxCount })) };
  return { viewport, bins, densityPath: scaledDensityPath };
}

export interface IntegrandPlot {
  viewport: Viewport;
  bandPoints: Array<{ x: number; yLow: number; yHigh: number }>;
  estimatePoints: Array<{ x: number; y: number }>;
  trueValueLine: Array<{ x: number; y: number }>;
}

/** Shared between the integrand canvas's draw effect and its SVG export (issue #45). */
export function integrandPlot(integrandResult: IntegrandResult, revealedCheckpoints: number): IntegrandPlot | null {
  if (!integrandResult.ok) return null;
  const { trueValue, convergence, n } = integrandResult.result;
  const shown = convergence.slice(0, revealedCheckpoints || convergence.length);
  if (shown.length === 0) return null;
  const bandLo = shown.map((c) => c.estimate - c.errorBand);
  const bandHi = shown.map((c) => c.estimate + c.errorBand);
  const yMin = Math.min(trueValue, ...bandLo);
  const yMax = Math.max(trueValue, ...bandHi);
  const pad = Math.max((yMax - yMin) * 0.1, 1e-6);
  const viewport: Viewport = { xMin: 0, xMax: n, yMin: yMin - pad, yMax: yMax + pad };
  return {
    viewport,
    bandPoints: shown.map((c) => ({ x: c.n, yLow: c.estimate - c.errorBand, yHigh: c.estimate + c.errorBand })),
    estimatePoints: shown.map((c) => ({ x: c.n, y: c.estimate })),
    trueValueLine: [
      { x: viewport.xMin, y: trueValue },
      { x: viewport.xMax, y: trueValue },
    ],
  };
}

function useMonteCarloGraph(cellId: string): CellGraph {
  const ref = useRef<CellGraph | null>(null);
  if (!ref.current) {
    const graph = new CellGraph();
    const ids = cellIdsMonteCarlo(cellId);
    const decoded = typeof window !== "undefined" ? decodeMonteCarloState(window.location.hash.slice(1)) : null;
    seedMonteCarloState(graph, ids, decoded ?? DEFAULT_MONTE_CARLO_STATE);

    graph.define(ids.dartResult, (): DartResult => {
      try {
        const seed = Number(graph.get<string>(ids.seed));
        const n = Number(graph.get<string>(ids.dartCount));
        if ([seed, n].some(Number.isNaN)) throw new Error("Seed and dart count must be numbers.");
        if (!Number.isInteger(n) || n <= 0) throw new Error("Dart count must be a positive integer.");
        return { ok: true, result: estimateDartPi(n, new Rng(seed)) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    graph.define(ids.histResult, (): HistResult => {
      try {
        const seed = Number(graph.get<string>(ids.seed));
        const n = Number(graph.get<string>(ids.sampleCount));
        const distType = graph.get<MonteCarloDistType>(ids.distType);
        if ([seed, n].some(Number.isNaN)) throw new Error("Seed and sample count must be numbers.");
        if (!Number.isInteger(n) || n <= 0) throw new Error("Sample count must be a positive integer.");
        const params = {
          mean: Number(graph.get<string>(ids.distMean)),
          sd: Number(graph.get<string>(ids.distSd)),
          a: Number(graph.get<string>(ids.distA)),
          b: Number(graph.get<string>(ids.distB)),
          rate: Number(graph.get<string>(ids.distRate)),
          n: Number(graph.get<string>(ids.distN)),
          p: Number(graph.get<string>(ids.distP)),
          lambda: Number(graph.get<string>(ids.distLambda)),
        };
        // Use a distinct Rng from the dart-throwing one (offset seed) so the
        // two sections don't share a stream and silently correlate.
        return { ok: true, result: sampleDistributionHistogram(distType, params, n, new Rng(seed + 1)) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    graph.define(ids.integrandResult, (): IntegrandResult => {
      try {
        const seed = Number(graph.get<string>(ids.seed));
        const a = Number(graph.get<string>(ids.integrandA));
        const b = Number(graph.get<string>(ids.integrandB));
        const n = Number(graph.get<string>(ids.integrandSampleCount));
        if ([seed, a, b, n].some(Number.isNaN)) throw new Error("Seed, bounds, and sample count must all be numbers.");
        const exprText = graph.get<string>(ids.integrandText);
        // A third distinct Rng offset (seed+2), same reasoning as the
        // histogram's seed+1 -- three independent streams, not one shared
        // one silently correlating across sections.
        return { ok: true, result: estimateMonteCarloIntegral(exprText, "x", a, b, n, new Rng(seed + 2)) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    ref.current = graph;
  }
  return ref.current;
}

/** Seeded (reproducible) Monte Carlo demos: pi estimation via dart-throwing, and a distribution-sampling histogram with its theoretical density overlaid. */
export function MonteCarloPanel({ cellId = "monte-carlo-1" }: { cellId?: string } = {}) {
  const graph = useMonteCarloGraph(cellId);
  useCellGraphTools(`data_montecarlo_${cellId}`, graph);
  const ids = cellIdsMonteCarlo(cellId);

  const dartCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const convergenceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const histCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const integrandCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const seed = useCell<string>(graph, ids.seed);
  const dartCount = useCell<string>(graph, ids.dartCount);
  const dartResult = useCell<DartResult>(graph, ids.dartResult);
  const distType = useCell<MonteCarloDistType>(graph, ids.distType);
  const distMean = useCell<string>(graph, ids.distMean);
  const distSd = useCell<string>(graph, ids.distSd);
  const distA = useCell<string>(graph, ids.distA);
  const distB = useCell<string>(graph, ids.distB);
  const distRate = useCell<string>(graph, ids.distRate);
  const distN = useCell<string>(graph, ids.distN);
  const distP = useCell<string>(graph, ids.distP);
  const distLambda = useCell<string>(graph, ids.distLambda);
  const sampleCount = useCell<string>(graph, ids.sampleCount);
  const histResult = useCell<HistResult>(graph, ids.histResult);
  const integrandText = useCell<string>(graph, ids.integrandText);
  const integrandA = useCell<string>(graph, ids.integrandA);
  const integrandB = useCell<string>(graph, ids.integrandB);
  const integrandSampleCount = useCell<string>(graph, ids.integrandSampleCount);
  const integrandResult = useCell<IntegrandResult>(graph, ids.integrandResult);

  const [integrandInput, setIntegrandInput] = useState(integrandText);
  useEffect(() => {
    setIntegrandInput(integrandText);
  }, [integrandText]);

  // Animated convergence reveal: steps through the checkpoint list one at a
  // time on an interval rather than drawing every checkpoint at once, so
  // "watch it converge" is an actual animation, not a static finished chart.
  // A purpose-built play/pause counter, not the shared timeline.ts keyframe
  // system -- that's designed for continuously interpolating a slider
  // parameter over wall-clock time, not revealing a discrete, already-
  // computed checkpoint list in order; reaching for it here would be a
  // worse fit than this much smaller mechanism.
  const [revealedCheckpoints, setRevealedCheckpoints] = useState(0);
  const [playing, setPlaying] = useState(false);
  const totalCheckpoints = integrandResult.ok ? integrandResult.result.convergence.length : 0;

  useEffect(() => {
    setRevealedCheckpoints(0);
    setPlaying(false);
  }, [integrandResult]);

  useEffect(() => {
    if (!playing) return;
    if (revealedCheckpoints >= totalCheckpoints) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setRevealedCheckpoints((c) => c + 1), 30);
    return () => clearTimeout(timer);
  }, [playing, revealedCheckpoints, totalCheckpoints]);

  const [seedInput, setSeedInput] = useState(seed);
  useEffect(() => {
    setSeedInput(seed);
  }, [seed]);

  useEffect(() => {
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeMonteCarloState(getCurrentMonteCarloState(graph, ids))}`);
    }
    writeUrl();
    return graph.subscribeAll(writeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  useEffect(() => {
    const ctx = dartCanvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    const plot = dartPlot(dartResult);
    if (plot) {
      drawAxes(ctx, plot.viewport, WIDTH, HEIGHT);
      drawScatter(ctx, plot.insidePoints, plot.viewport, WIDTH, HEIGHT, 1.5, "#16a34a");
      drawScatter(ctx, plot.outsidePoints, plot.viewport, WIDTH, HEIGHT, 1.5, "#dc2626");
    }
  }, [dartResult]);

  useEffect(() => {
    const ctx = convergenceCanvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, WIDTH, 120);
    const plot = convergencePlot(dartResult);
    if (plot) {
      drawAxes(ctx, plot.viewport, WIDTH, 120);
      drawScatter(ctx, plot.points, plot.viewport, WIDTH, 120, 1.5, "#2563eb");
      if (plot.piReferenceLine) {
        ctx.save();
        ctx.strokeStyle = "#9ca3af";
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        plot.piReferenceLine.forEach((p, i) => {
          const sx = ((p.x - plot.viewport.xMin) / (plot.viewport.xMax - plot.viewport.xMin)) * WIDTH;
          const sy = 120 - ((p.y - plot.viewport.yMin) / (plot.viewport.yMax - plot.viewport.yMin)) * 120;
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        });
        ctx.stroke();
        ctx.restore();
      }
    }
  }, [dartResult]);

  useEffect(() => {
    const ctx = histCanvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    const plot = histogramPlot(histResult);
    if (plot) {
      drawAxes(ctx, plot.viewport, WIDTH, HEIGHT);
      drawHistogram(ctx, plot.bins, plot.viewport, WIDTH, HEIGHT);
      drawPath(ctx, plot.densityPath, plot.viewport, WIDTH, HEIGHT);
    }
  }, [histResult]);

  useEffect(() => {
    const ctx = integrandCanvasRef.current?.getContext("2d");
    if (!ctx) return;
    const height = 220;
    ctx.clearRect(0, 0, WIDTH, height);
    const plot = integrandPlot(integrandResult, revealedCheckpoints);
    if (!plot) return;
    drawAxes(ctx, plot.viewport, WIDTH, height);

    ctx.save();
    ctx.fillStyle = "rgba(37, 99, 235, 0.15)";
    ctx.beginPath();
    plot.bandPoints.forEach((p, i) => {
      const sx = toScreenX(p.x, plot.viewport, WIDTH);
      const sy = toScreenY(p.yHigh, plot.viewport, height);
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    for (let i = plot.bandPoints.length - 1; i >= 0; i--) {
      const p = plot.bandPoints[i];
      if (!p) continue;
      ctx.lineTo(toScreenX(p.x, plot.viewport, WIDTH), toScreenY(p.yLow, plot.viewport, height));
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    drawPolyline(ctx, plot.estimatePoints, plot.viewport, WIDTH, height, "#2563eb");

    ctx.save();
    ctx.strokeStyle = "#9ca3af";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    plot.trueValueLine.forEach((p, i) => {
      const sx = toScreenX(p.x, plot.viewport, WIDTH);
      const sy = toScreenY(p.y, plot.viewport, height);
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.stroke();
    ctx.restore();
  }, [integrandResult, revealedCheckpoints]);

  function updateSeed(value: string) {
    setSeedInput(value);
    graph.set(ids.seed, value);
  }

  function updateIntegrand(value: string) {
    setIntegrandInput(value);
    graph.set(ids.integrandText, value);
  }

  return (
    <div>
      <h2>Estimate π by dart-throwing</h2>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <label>
          seed: <input value={seedInput} onChange={(e) => updateSeed(e.target.value)} style={{ font: "inherit", width: "8ch" }} />
        </label>
        <label>
          darts:{" "}
          <input
            type="number"
            value={dartCount}
            onChange={(e) => graph.set(ids.dartCount, e.target.value)}
            style={{ font: "inherit", width: "8ch" }}
          />
        </label>
      </div>
      <canvas ref={dartCanvasRef} width={WIDTH} height={HEIGHT} style={{ border: "1px solid var(--border)" }} />
      <canvas ref={convergenceCanvasRef} width={WIDTH} height={120} style={{ border: "1px solid var(--border)", display: "block", marginTop: "0.25rem" }} />
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.5rem" }}>
        <PngExportButton getCanvas={() => dartCanvasRef.current} label="monte-carlo-darts" />
        <SvgExportButton
          getSvg={() => {
            const plot = dartPlot(dartResult);
            if (!plot) return null;
            const layers: SvgLayer[] = [
              { kind: "scatter", points: plot.insidePoints, color: "#16a34a", radius: 1.5 },
              { kind: "scatter", points: plot.outsidePoints, color: "#dc2626", radius: 1.5 },
            ];
            return layersToSvgDocument(layers, plot.viewport, WIDTH, HEIGHT);
          }}
          label="monte-carlo-darts"
        />
        <PngExportButton getCanvas={() => convergenceCanvasRef.current} label="monte-carlo-convergence" />
        <SvgExportButton
          getSvg={() => {
            const plot = convergencePlot(dartResult);
            if (!plot) return null;
            const layers: SvgLayer[] = [{ kind: "scatter", points: plot.points, color: "#2563eb", radius: 1.5 }];
            if (plot.piReferenceLine) layers.push({ kind: "polyline", points: plot.piReferenceLine, color: "#9ca3af", dash: [4, 4] });
            return layersToSvgDocument(layers, plot.viewport, WIDTH, 120);
          }}
          label="monte-carlo-convergence"
        />
      </div>
      {dartResult.ok ? (
        <p>π estimate = {dartResult.result.piEstimate.toFixed(5)} (actual π ≈ 3.14159)</p>
      ) : (
        <p style={{ color: "var(--danger)" }}>{dartResult.message}</p>
      )}

      <h2>Distribution sampling</h2>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <label>
          distribution:{" "}
          <select value={distType} onChange={(e) => graph.set(ids.distType, e.target.value as MonteCarloDistType)}>
            {(Object.keys(DIST_LABELS) as MonteCarloDistType[]).map((t) => (
              <option key={t} value={t}>
                {DIST_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label>
          n:{" "}
          <input
            type="number"
            value={sampleCount}
            onChange={(e) => graph.set(ids.sampleCount, e.target.value)}
            style={{ font: "inherit", width: "8ch" }}
          />
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
        {distType === "uniform" && (
          <>
            <label>
              a: <input value={distA} onChange={(e) => graph.set(ids.distA, e.target.value)} style={{ font: "inherit", width: "8ch" }} />
            </label>
            <label>
              b: <input value={distB} onChange={(e) => graph.set(ids.distB, e.target.value)} style={{ font: "inherit", width: "8ch" }} />
            </label>
          </>
        )}
        {distType === "exponential" && (
          <label>
            rate: <input value={distRate} onChange={(e) => graph.set(ids.distRate, e.target.value)} style={{ font: "inherit", width: "8ch" }} />
          </label>
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
      </div>
      <canvas ref={histCanvasRef} width={WIDTH} height={HEIGHT} style={{ border: "1px solid var(--border)" }} />
      <div style={{ margin: "0.25rem 0" }}>
        <PngExportButton getCanvas={() => histCanvasRef.current} label="monte-carlo-histogram" />
        <SvgExportButton
          getSvg={() => {
            const plot = histogramPlot(histResult);
            if (!plot) return null;
            const layers: SvgLayer[] = [{ kind: "histogram", bins: plot.bins }, { kind: "path", path: plot.densityPath }];
            return layersToSvgDocument(layers, plot.viewport, WIDTH, HEIGHT);
          }}
          label="monte-carlo-histogram"
        />
      </div>
      {histResult.ok ? (
        <p>
          sample mean = {histResult.result.sampleMean.toFixed(4)} (theoretical {histResult.result.theoreticalMean.toFixed(4)}), sample
          variance = {histResult.result.sampleVariance.toFixed(4)} (theoretical {histResult.result.theoreticalVariance.toFixed(4)})
        </p>
      ) : (
        <p style={{ color: "var(--danger)" }}>{histResult.message}</p>
      )}

      <h2>Monte Carlo integration</h2>
      <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>
        Estimates ∫f(x)dx over [a, b] by averaging random samples, compared against the exact value.
      </p>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <label>
          f(x) ={" "}
          <input value={integrandInput} onChange={(e) => updateIntegrand(e.target.value)} style={{ font: "inherit", width: "14ch" }} />
        </label>
        <label>
          a: <input value={integrandA} onChange={(e) => graph.set(ids.integrandA, e.target.value)} style={{ font: "inherit", width: "6ch" }} />
        </label>
        <label>
          b: <input value={integrandB} onChange={(e) => graph.set(ids.integrandB, e.target.value)} style={{ font: "inherit", width: "6ch" }} />
        </label>
        <label>
          n:{" "}
          <input
            type="number"
            value={integrandSampleCount}
            onChange={(e) => graph.set(ids.integrandSampleCount, e.target.value)}
            style={{ font: "inherit", width: "8ch" }}
          />
        </label>
      </div>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.5rem" }}>
        <button
          type="button"
          onClick={() => {
            if (revealedCheckpoints >= totalCheckpoints) setRevealedCheckpoints(0);
            setPlaying((p) => !p);
          }}
          disabled={!integrandResult.ok || totalCheckpoints === 0}
        >
          {playing ? "Pause" : revealedCheckpoints >= totalCheckpoints && totalCheckpoints > 0 ? "Replay" : "Play"}
        </button>
        <button type="button" onClick={() => { setPlaying(false); setRevealedCheckpoints(0); }} disabled={!integrandResult.ok}>
          Reset
        </button>
      </div>
      <canvas ref={integrandCanvasRef} width={WIDTH} height={220} style={{ border: "1px solid var(--border)", display: "block" }} />
      <div style={{ margin: "0.25rem 0" }}>
        <PngExportButton getCanvas={() => integrandCanvasRef.current} label="monte-carlo-integrand" />
        <SvgExportButton
          getSvg={() => {
            const plot = integrandPlot(integrandResult, revealedCheckpoints);
            if (!plot) return null;
            const layers: SvgLayer[] = [
              { kind: "band", points: plot.bandPoints },
              { kind: "polyline", points: plot.estimatePoints, color: "#2563eb" },
              { kind: "polyline", points: plot.trueValueLine, color: "#9ca3af", dash: [4, 4] },
            ];
            return layersToSvgDocument(layers, plot.viewport, WIDTH, 220);
          }}
          label="monte-carlo-integrand"
        />
      </div>
      {integrandResult.ok ? (
        <p>
          estimate = {integrandResult.result.estimate.toFixed(5)} (true value {integrandResult.result.trueValue.toFixed(5)}), absolute
          error = {integrandResult.result.absoluteError.toFixed(5)}
        </p>
      ) : (
        <p style={{ color: "var(--danger)" }}>{integrandResult.message}</p>
      )}
    </div>
  );
}
