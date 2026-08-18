import { useEffect, useRef, useState } from "react";
import { drawAxes, drawPolyline, type Viewport } from "../lib/render-path.ts";
import {
  computeWindowedAverage,
  generateNoisySignal,
  runConcurrentOrderingDemo,
  runShuffleEpochsDemo,
  simulatePrefetchTiming,
  simulateTeeConsumers,
} from "../lib/streaming-dataset-demo.ts";
import { PngExportButton } from "./PngExportButton.tsx";

const SWATCH_COLORS = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#9333ea", "#0891b2", "#db2777", "#65a30d", "#4f46e5", "#ea580c"];
function swatchColor(originalIndex: number): string {
  return SWATCH_COLORS[originalIndex % SWATCH_COLORS.length];
}

const TIMING_WIDTH = 480;
const TIMING_HEIGHT = 260;

/**
 * Shared chart for any "two arrival-time series" demo: item ordinal -> ms
 * since the run started, on shared axes. Used by Demo B (prefetch vs. no
 * prefetch) and Demo E (tee's fast vs. slow branch). Extracted so both the
 * live effect and the PNG 2x re-render call the same drawing code (the
 * `drawGraphCanvas` precedent from issue #45's 2x work).
 */
export function drawTwoSeriesTimingChart(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seriesA: number[],
  colorA: string,
  seriesB: number[],
  colorB: string,
): void {
  ctx.clearRect(0, 0, width, height);
  const allArrivals = [...seriesA, ...seriesB];
  const maxItems = Math.max(seriesA.length, seriesB.length, 1);
  const maxMs = Math.max(...allArrivals, 1);
  const viewport: Viewport = { xMin: 0, xMax: maxItems - 1 || 1, yMin: 0, yMax: maxMs * 1.1 };
  drawAxes(ctx, viewport, width, height);
  if (seriesB.length > 0) {
    drawPolyline(
      ctx,
      seriesB.map((ms, i) => ({ x: i, y: ms })),
      viewport,
      width,
      height,
      colorB,
    );
  }
  if (seriesA.length > 0) {
    drawPolyline(
      ctx,
      seriesA.map((ms, i) => ({ x: i, y: ms })),
      viewport,
      width,
      height,
      colorA,
    );
  }
}

/** Demo B's chart: with-prefetch vs. without-prefetch arrival times. */
export function drawPrefetchTimingChart(ctx: CanvasRenderingContext2D, width: number, height: number, withPrefetch: number[], withoutPrefetch: number[]): void {
  drawTwoSeriesTimingChart(ctx, width, height, withPrefetch, "#2563eb", withoutPrefetch, "#dc2626");
}

/** Demo E's chart: tee's fast-branch vs. slow-branch arrival times. */
export function drawTeeTimingChart(ctx: CanvasRenderingContext2D, width: number, height: number, fastArrivals: number[], slowArrivals: number[]): void {
  drawTwoSeriesTimingChart(ctx, width, height, fastArrivals, "#16a34a", slowArrivals, "#9333ea");
}

const SMOOTHING_WIDTH = 480;
const SMOOTHING_HEIGHT = 260;

/**
 * Demo D's chart: the raw noisy signal (gray) plus the windowed moving
 * average (blue) on shared axes, the smoothed line shifted right by half
 * the window so each averaged point lines up under the window it summarizes.
 */
export function drawSmoothingChart(ctx: CanvasRenderingContext2D, width: number, height: number, raw: number[], smoothed: number[], windowSize: number): void {
  ctx.clearRect(0, 0, width, height);
  if (raw.length === 0) return;
  const allValues = [...raw, ...smoothed];
  const yMin = Math.min(...allValues);
  const yMax = Math.max(...allValues);
  const pad = (yMax - yMin) * 0.1 || 1;
  const viewport: Viewport = { xMin: 0, xMax: raw.length - 1 || 1, yMin: yMin - pad, yMax: yMax + pad };
  drawAxes(ctx, viewport, width, height);
  drawPolyline(
    ctx,
    raw.map((y, i) => ({ x: i, y })),
    viewport,
    width,
    height,
    "#94a3b8",
  );
  const offset = (windowSize - 1) / 2;
  if (smoothed.length > 0) {
    drawPolyline(
      ctx,
      smoothed.map((y, i) => ({ x: i + offset, y })),
      viewport,
      width,
      height,
      "#2563eb",
    );
  }
}

/**
 * Issue #58 (demos A-B) plus issue #259's follow-ups (demos C-E): five
 * bounded demos making `mallory-data`/`mallory-iteration`'s async streaming
 * primitives visible -- (A) watch a synthetic dataset's order reshuffle
 * across epochs, (B) watch `.prefetch()` overlap producer/consumer latency
 * against a run without it, (C) contrast `mapConcurrent`'s ordered vs.
 * completion-order output, (D) smooth a noisy signal with a sliding window,
 * and (E) watch `tee`'s independent, unboundedly-buffered branches. All as
 * live-updating charts/visuals (not just final numbers). Deliberately a
 * standalone demo with plain React state, not a CellGraph-backed panel:
 * none of these views represent a "current calculator state" worth
 * bookmarking/sharing, unlike the rest of this app's panels.
 */
export function StreamingDatasetPanel() {
  // Demo A: shuffle-across-epochs
  const [size, setSize] = useState("8");
  const [epochCount, setEpochCount] = useState("5");
  const [seed, setSeed] = useState("1");
  const [bufferSize, setBufferSize] = useState("");
  const [epochs, setEpochs] = useState<number[][] | null>(null);
  const [epochIndex, setEpochIndex] = useState(0);
  const [shufflePlaying, setShufflePlaying] = useState(false);
  const [shuffleRunning, setShuffleRunning] = useState(false);
  const [shuffleError, setShuffleError] = useState<string | null>(null);

  async function handleRunShuffle() {
    setShuffleRunning(true);
    setShuffleError(null);
    setShufflePlaying(false);
    try {
      const n = Number(size);
      const e = Number(epochCount);
      const s = Number(seed);
      const buf = bufferSize.trim() === "" ? undefined : Number(bufferSize);
      if (Number.isNaN(n) || Number.isNaN(e) || Number.isNaN(s) || (bufferSize.trim() !== "" && Number.isNaN(buf))) {
        throw new Error("Size, epoch count, seed, and buffer size must all be numbers.");
      }
      const result = await runShuffleEpochsDemo(n, e, s, buf);
      setEpochs(result);
      setEpochIndex(0);
    } catch (e) {
      setShuffleError(e instanceof Error ? e.message : String(e));
    } finally {
      setShuffleRunning(false);
    }
  }

  useEffect(() => {
    if (!shufflePlaying || !epochs) return;
    const id = setInterval(() => {
      setEpochIndex((i) => {
        if (i + 1 >= epochs.length) {
          setShufflePlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 700);
    return () => clearInterval(id);
  }, [shufflePlaying, epochs]);

  // Demo B: prefetch-vs-no-prefetch timing
  const [itemCount, setItemCount] = useState("8");
  const [produceMs, setProduceMs] = useState("150");
  const [consumeMs, setConsumeMs] = useState("150");
  const [prefetchN, setPrefetchN] = useState("2");
  const [timingRunning, setTimingRunning] = useState(false);
  const [timingError, setTimingError] = useState<string | null>(null);
  const [withPrefetchArrivals, setWithPrefetchArrivals] = useState<number[]>([]);
  const [withoutPrefetchArrivals, setWithoutPrefetchArrivals] = useState<number[]>([]);
  const timingCanvasRef = useRef<HTMLCanvasElement | null>(null);

  async function handleRunTiming() {
    setTimingRunning(true);
    setTimingError(null);
    setWithPrefetchArrivals([]);
    setWithoutPrefetchArrivals([]);
    try {
      const n = Number(itemCount);
      const produce = Number(produceMs);
      const consume = Number(consumeMs);
      const pf = Number(prefetchN);
      if (Number.isNaN(n) || Number.isNaN(produce) || Number.isNaN(consume) || Number.isNaN(pf)) {
        throw new Error("Item count, produce/consume ms, and prefetch buffer must all be numbers.");
      }
      await simulatePrefetchTiming(n, produce, consume, pf, undefined, (config, _index, ms) => {
        if (config === "withPrefetch") setWithPrefetchArrivals((prev) => [...prev, ms]);
        else setWithoutPrefetchArrivals((prev) => [...prev, ms]);
      });
    } catch (e) {
      setTimingError(e instanceof Error ? e.message : String(e));
    } finally {
      setTimingRunning(false);
    }
  }

  useEffect(() => {
    const canvas = timingCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;
    drawPrefetchTimingChart(ctx, TIMING_WIDTH, TIMING_HEIGHT, withPrefetchArrivals, withoutPrefetchArrivals);
  }, [withPrefetchArrivals, withoutPrefetchArrivals]);

  // Demo C: mapConcurrent -- ordered vs. completion-order
  const [orderItemCount, setOrderItemCount] = useState("8");
  const [orderFastMs, setOrderFastMs] = useState("20");
  const [orderSlowMs, setOrderSlowMs] = useState("200");
  const [orderConcurrency, setOrderConcurrency] = useState("8");
  const [orderRunning, setOrderRunning] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [orderedResult, setOrderedResult] = useState<number[] | null>(null);
  const [unorderedResult, setUnorderedResult] = useState<number[] | null>(null);

  async function handleRunOrdering() {
    setOrderRunning(true);
    setOrderError(null);
    setOrderedResult(null);
    setUnorderedResult(null);
    try {
      const n = Number(orderItemCount);
      const fast = Number(orderFastMs);
      const slow = Number(orderSlowMs);
      const concurrency = Number(orderConcurrency);
      if (Number.isNaN(n) || Number.isNaN(fast) || Number.isNaN(slow) || Number.isNaN(concurrency)) {
        throw new Error("Item count, fast/slow ms, and concurrency must all be numbers.");
      }
      // Alternate slow/fast so mapConcurrent's two ordering modes visibly diverge.
      const { ordered, unordered } = await runConcurrentOrderingDemo(n, [slow, fast], concurrency);
      setOrderedResult(ordered);
      setUnorderedResult(unordered);
    } catch (e) {
      setOrderError(e instanceof Error ? e.message : String(e));
    } finally {
      setOrderRunning(false);
    }
  }

  // Demo D: sliding-window smoothing
  const [signalN, setSignalN] = useState("60");
  const [signalSeed, setSignalSeed] = useState("1");
  const [noiseAmplitude, setNoiseAmplitude] = useState("0.6");
  const [windowSize, setWindowSize] = useState("5");
  const [smoothingError, setSmoothingError] = useState<string | null>(null);
  const [rawSignal, setRawSignal] = useState<number[]>([]);
  const [smoothedSignal, setSmoothedSignal] = useState<number[]>([]);
  const [appliedWindowSize, setAppliedWindowSize] = useState(1);
  const smoothingCanvasRef = useRef<HTMLCanvasElement | null>(null);

  async function handleRunSmoothing() {
    setSmoothingError(null);
    try {
      const n = Number(signalN);
      const seedNum = Number(signalSeed);
      const amplitude = Number(noiseAmplitude);
      const w = Number(windowSize);
      if (Number.isNaN(n) || Number.isNaN(seedNum) || Number.isNaN(amplitude) || Number.isNaN(w)) {
        throw new Error("Sample count, seed, noise amplitude, and window size must all be numbers.");
      }
      const raw = generateNoisySignal(n, seedNum, amplitude);
      const smoothed = await computeWindowedAverage(raw, w);
      setRawSignal(raw);
      setSmoothedSignal(smoothed);
      setAppliedWindowSize(w);
    } catch (e) {
      setSmoothingError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    handleRunSmoothing();
    // Run once on mount to seed the chart -- handleRunSmoothing reads the
    // current input state directly rather than being passed as a stable dep.
  }, []);

  useEffect(() => {
    const canvas = smoothingCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;
    drawSmoothingChart(ctx, SMOOTHING_WIDTH, SMOOTHING_HEIGHT, rawSignal, smoothedSignal, appliedWindowSize);
  }, [rawSignal, smoothedSignal, appliedWindowSize]);

  // Demo E: tee -- independent consumers, unbounded buffering
  const [teeItemCount, setTeeItemCount] = useState("10");
  const [teeProduceMs, setTeeProduceMs] = useState("100");
  const [teeFastConsumeMs, setTeeFastConsumeMs] = useState("50");
  const [teeSlowConsumeMs, setTeeSlowConsumeMs] = useState("400");
  const [teeRunning, setTeeRunning] = useState(false);
  const [teeError, setTeeError] = useState<string | null>(null);
  const [fastArrivals, setFastArrivals] = useState<number[]>([]);
  const [slowArrivals, setSlowArrivals] = useState<number[]>([]);
  const teeCanvasRef = useRef<HTMLCanvasElement | null>(null);

  async function handleRunTee() {
    setTeeRunning(true);
    setTeeError(null);
    setFastArrivals([]);
    setSlowArrivals([]);
    try {
      const n = Number(teeItemCount);
      const produce = Number(teeProduceMs);
      const fast = Number(teeFastConsumeMs);
      const slow = Number(teeSlowConsumeMs);
      if (Number.isNaN(n) || Number.isNaN(produce) || Number.isNaN(fast) || Number.isNaN(slow)) {
        throw new Error("Item count, produce ms, and fast/slow consume ms must all be numbers.");
      }
      await simulateTeeConsumers(n, produce, fast, slow, undefined, (branch, _item, ms) => {
        if (branch === "fast") setFastArrivals((prev) => [...prev, ms]);
        else setSlowArrivals((prev) => [...prev, ms]);
      });
    } catch (e) {
      setTeeError(e instanceof Error ? e.message : String(e));
    } finally {
      setTeeRunning(false);
    }
  }

  useEffect(() => {
    const canvas = teeCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;
    drawTeeTimingChart(ctx, TIMING_WIDTH, TIMING_HEIGHT, fastArrivals, slowArrivals);
  }, [fastArrivals, slowArrivals]);

  const currentEpoch = epochs?.[epochIndex] ?? null;

  return (
    <div>
      <div style={{ background: "var(--surface-alt, rgba(127,127,127,0.08))", border: "1px solid var(--muted)", borderRadius: "6px", padding: "0.75rem 1rem", marginBottom: "1rem" }}>
        <p style={{ margin: "0 0 0.5rem" }}>
          A "streaming dataset" here means data processed as an <em>async iterable</em> -- a sequence of items produced and consumed one (or a few)
          at a time, rather than loaded into memory all at once. This panel makes that normally-invisible pipeline visible by charting exactly when
          each item is produced or consumed, using <code>mallory-data</code>'s <code>Dataset</code> (built on <code>mallory-iteration</code>'s async
          iteration primitives) as the engine underneath every demo below.
        </p>
        <p style={{ margin: 0 }}>
          This matters whenever a data source is too big to hold in memory, arrives incrementally (files, network responses, sensor readings, ML
          training batches), or is expensive enough per item that overlapping work -- instead of doing it all strictly one step at a time -- changes
          how long a pipeline takes to run. The five demos below each isolate one primitive: reshuffling across epochs, overlapping produce/consume
          with <code>.prefetch()</code>, trading output order for latency with <code>mapConcurrent</code>, smoothing a stream with a sliding window,
          and splitting one stream into independently-paced consumers with <code>tee</code>.
        </p>
      </div>

      <h2>Watch epochs reshuffle</h2>
      <p style={{ color: "var(--muted)" }}>
        A synthetic dataset of <code>size</code> items run through <code>Dataset.epochs(epochCount, {"{"}reshuffle: {"{"}seed, bufferSize{"}"}
        {"}"})</code> -- each swatch is one item (color = its original position), and its position in the row is where that epoch put it.
      </p>
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center", margin: "0.25rem 0" }}>
        <label>
          size <input value={size} onChange={(e) => setSize(e.target.value)} style={{ width: "5ch" }} />
        </label>
        <label>
          epochs <input value={epochCount} onChange={(e) => setEpochCount(e.target.value)} style={{ width: "5ch" }} />
        </label>
        <label>
          seed <input value={seed} onChange={(e) => setSeed(e.target.value)} style={{ width: "5ch" }} />
        </label>
        <label>
          buffer size <input value={bufferSize} onChange={(e) => setBufferSize(e.target.value)} placeholder="full" style={{ width: "6ch" }} />
        </label>
        <button type="button" onClick={handleRunShuffle} disabled={shuffleRunning}>
          {shuffleRunning ? "Running…" : "Run"}
        </button>
      </div>
      {shuffleError && <p style={{ color: "var(--danger)" }}>{shuffleError}</p>}
      {epochs && currentEpoch && (
        <div>
          <div style={{ display: "flex", gap: "2px", margin: "0.5rem 0", flexWrap: "wrap" }}>
            {currentEpoch.map((originalIndex) => (
              <div
                key={originalIndex}
                style={{ width: "1.75rem", height: "1.75rem", background: swatchColor(originalIndex), borderRadius: "3px" }}
                title={`original index ${originalIndex}`}
              />
            ))}
          </div>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <button type="button" onClick={() => setShufflePlaying((p) => !p)}>
              {shufflePlaying ? "Pause" : "Play"}
            </button>
            <input
              type="range"
              min={0}
              max={epochs.length - 1}
              value={epochIndex}
              onChange={(e) => {
                setShufflePlaying(false);
                setEpochIndex(Number(e.target.value));
              }}
              style={{ flex: "1 1 auto", minWidth: "10rem" }}
            />
            <span>
              epoch {epochIndex + 1} / {epochs.length}
            </span>
          </div>
        </div>
      )}

      <h2>Prefetch vs. no-prefetch timing</h2>
      <p style={{ color: "var(--muted)" }}>
        Two pipelines process the same <code>itemCount</code> synthetic items, each taking <code>produceMs</code> to produce and{" "}
        <code>consumeMs</code> to consume. One is wrapped with <code>.prefetch(prefetchN)</code>, overlapping the next item's production with the
        current item's consumption; the other isn't. The chart fills in live as each pipeline actually runs.
      </p>
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center", margin: "0.25rem 0" }}>
        <label>
          items <input value={itemCount} onChange={(e) => setItemCount(e.target.value)} style={{ width: "5ch" }} />
        </label>
        <label>
          produce ms <input value={produceMs} onChange={(e) => setProduceMs(e.target.value)} style={{ width: "6ch" }} />
        </label>
        <label>
          consume ms <input value={consumeMs} onChange={(e) => setConsumeMs(e.target.value)} style={{ width: "6ch" }} />
        </label>
        <label>
          prefetch n <input value={prefetchN} onChange={(e) => setPrefetchN(e.target.value)} style={{ width: "5ch" }} />
        </label>
        <button type="button" onClick={handleRunTiming} disabled={timingRunning}>
          {timingRunning ? "Running…" : "Run"}
        </button>
      </div>
      {timingError && <p style={{ color: "var(--danger)" }}>{timingError}</p>}
      <canvas ref={timingCanvasRef} width={TIMING_WIDTH} height={TIMING_HEIGHT} style={{ border: "1px solid var(--muted)", maxWidth: "100%" }} />
      <p style={{ fontSize: "0.85rem" }}>
        <span style={{ color: "#2563eb" }}>■</span> with prefetch ({withPrefetchArrivals.length} arrived)
        {"  "}
        <span style={{ color: "#dc2626" }}>■</span> without prefetch ({withoutPrefetchArrivals.length} arrived)
      </p>
      <PngExportButton getCanvas={() => timingCanvasRef.current} label="streaming-dataset-prefetch-timing" />

      <h2>Concurrent map: ordered vs. completion order</h2>
      <p style={{ color: "var(--muted)" }}>
        <code>itemCount</code> items alternate between a slow (<code>slow ms</code>) and fast (<code>fast ms</code>) simulated transform, run through{" "}
        <code>mapConcurrent({"{"}concurrency{"}"})</code> twice -- once with the default <code>ordered: true</code>, once with{" "}
        <code>ordered: false</code>. Each row is one run's output sequence, left to right; color = the item's original position. Ordered always comes
        back 0, 1, 2, ... no matter how long an item takes; unordered lets fast items (light colors here, since fast items sit at odd original
        indices) overtake slow ones queued ahead of them.
      </p>
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center", margin: "0.25rem 0" }}>
        <label>
          items <input value={orderItemCount} onChange={(e) => setOrderItemCount(e.target.value)} style={{ width: "5ch" }} />
        </label>
        <label>
          fast ms <input value={orderFastMs} onChange={(e) => setOrderFastMs(e.target.value)} style={{ width: "6ch" }} />
        </label>
        <label>
          slow ms <input value={orderSlowMs} onChange={(e) => setOrderSlowMs(e.target.value)} style={{ width: "6ch" }} />
        </label>
        <label>
          concurrency <input value={orderConcurrency} onChange={(e) => setOrderConcurrency(e.target.value)} style={{ width: "5ch" }} />
        </label>
        <button type="button" onClick={handleRunOrdering} disabled={orderRunning}>
          {orderRunning ? "Running…" : "Run"}
        </button>
      </div>
      {orderError && <p style={{ color: "var(--danger)" }}>{orderError}</p>}
      {orderedResult && unorderedResult && (
        <div>
          <p style={{ margin: "0.5rem 0 0.25rem", fontSize: "0.85rem" }}>ordered: true</p>
          <div style={{ display: "flex", gap: "2px", flexWrap: "wrap" }}>
            {orderedResult.map((originalIndex, position) => (
              <div
                key={position}
                style={{ width: "1.75rem", height: "1.75rem", background: swatchColor(originalIndex), borderRadius: "3px" }}
                title={`original index ${originalIndex}`}
              />
            ))}
          </div>
          <p style={{ margin: "0.75rem 0 0.25rem", fontSize: "0.85rem" }}>ordered: false (completion order)</p>
          <div style={{ display: "flex", gap: "2px", flexWrap: "wrap" }}>
            {unorderedResult.map((originalIndex, position) => (
              <div
                key={position}
                style={{ width: "1.75rem", height: "1.75rem", background: swatchColor(originalIndex), borderRadius: "3px" }}
                title={`original index ${originalIndex}`}
              />
            ))}
          </div>
        </div>
      )}

      <h2>Sliding-window smoothing</h2>
      <p style={{ color: "var(--muted)" }}>
        A synthetic noisy signal of <code>n</code> samples run through <code>windowedAsync(values, windowSize)</code> -- an overlapping fixed-size
        window over the stream -- averaged per window into a moving average. Gray is the raw signal; blue is the smoothed one. A bigger window
        averages over more neighbors, trading responsiveness for smoothness -- the same primitive behind streaming moving averages and rolling
        metrics dashboards.
      </p>
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center", margin: "0.25rem 0" }}>
        <label>
          samples <input value={signalN} onChange={(e) => setSignalN(e.target.value)} style={{ width: "5ch" }} />
        </label>
        <label>
          seed <input value={signalSeed} onChange={(e) => setSignalSeed(e.target.value)} style={{ width: "5ch" }} />
        </label>
        <label>
          noise <input value={noiseAmplitude} onChange={(e) => setNoiseAmplitude(e.target.value)} style={{ width: "5ch" }} />
        </label>
        <label>
          window size <input value={windowSize} onChange={(e) => setWindowSize(e.target.value)} style={{ width: "5ch" }} />
        </label>
        <button type="button" onClick={handleRunSmoothing}>
          Run
        </button>
      </div>
      {smoothingError && <p style={{ color: "var(--danger)" }}>{smoothingError}</p>}
      <canvas ref={smoothingCanvasRef} width={SMOOTHING_WIDTH} height={SMOOTHING_HEIGHT} style={{ border: "1px solid var(--muted)", maxWidth: "100%" }} />
      <p style={{ fontSize: "0.85rem" }}>
        <span style={{ color: "#94a3b8" }}>■</span> raw signal
        {"  "}
        <span style={{ color: "#2563eb" }}>■</span> windowed average (window {appliedWindowSize})
      </p>
      <PngExportButton getCanvas={() => smoothingCanvasRef.current} label="streaming-dataset-smoothing" />

      <h2>Tee: independent consumers</h2>
      <p style={{ color: "var(--muted)" }}>
        One source producing <code>itemCount</code> items every <code>produce ms</code> is split with <code>teeAsync(2)</code> into two independent
        branches, read at different speeds (<code>fast ms</code> and <code>slow ms</code> per item). Unlike <code>.prefetch(n)</code> above -- which
        caps how far ahead the producer can get with a buffer of size <code>n</code> -- <code>tee</code> puts no bound on that buffer at all: the
        fast branch finishes on its own schedule, completely unaffected by how far behind the slow branch is, while every item the fast branch has
        already read but the slow branch hasn't sits buffered in memory until the slow branch catches up. Both branches still see every item, in
        the same order.
      </p>
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center", margin: "0.25rem 0" }}>
        <label>
          items <input value={teeItemCount} onChange={(e) => setTeeItemCount(e.target.value)} style={{ width: "5ch" }} />
        </label>
        <label>
          produce ms <input value={teeProduceMs} onChange={(e) => setTeeProduceMs(e.target.value)} style={{ width: "6ch" }} />
        </label>
        <label>
          fast ms <input value={teeFastConsumeMs} onChange={(e) => setTeeFastConsumeMs(e.target.value)} style={{ width: "6ch" }} />
        </label>
        <label>
          slow ms <input value={teeSlowConsumeMs} onChange={(e) => setTeeSlowConsumeMs(e.target.value)} style={{ width: "6ch" }} />
        </label>
        <button type="button" onClick={handleRunTee} disabled={teeRunning}>
          {teeRunning ? "Running…" : "Run"}
        </button>
      </div>
      {teeError && <p style={{ color: "var(--danger)" }}>{teeError}</p>}
      <canvas ref={teeCanvasRef} width={TIMING_WIDTH} height={TIMING_HEIGHT} style={{ border: "1px solid var(--muted)", maxWidth: "100%" }} />
      <p style={{ fontSize: "0.85rem" }}>
        <span style={{ color: "#16a34a" }}>■</span> fast branch ({fastArrivals.length} arrived)
        {"  "}
        <span style={{ color: "#9333ea" }}>■</span> slow branch ({slowArrivals.length} arrived)
      </p>
      <PngExportButton getCanvas={() => teeCanvasRef.current} label="streaming-dataset-tee" />
    </div>
  );
}
