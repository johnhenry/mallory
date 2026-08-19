import { useEffect, useMemo, useRef, useState } from "react";
import { metric } from "mallory-telemetry";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsMlPlayground, type CellIdsMlPlayground } from "../lib/cell-ids.ts";
import {
  DEFAULT_ML_PLAYGROUND_STATE,
  decodeMlPlaygroundState,
  encodeMlPlaygroundState,
  type MlPlaygroundState,
} from "../lib/ml-playground-state.ts";
import {
  MAX_CLASSES,
  TinyMlp,
  generateDataset,
  inferNumClasses,
  installMetricSink,
  predictClassGrid,
  predictProbabilityGrid,
  trainModel,
  type DatasetType,
  type LabeledPoint,
} from "../lib/ml-playground.ts";
import { drawAxes, drawPolyline, drawScatter } from "../lib/render-path.ts";
import { canvasEventPoint, toDataX, toDataY, type Viewport } from "../lib/viewport.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useCell } from "../lib/use-cell.ts";
import { PngExportButton } from "./PngExportButton.tsx";

type Result<T> = { ok: true; value: T } | { ok: false; message: string };

const BOUNDARY_SIZE = 360;
const LOSS_WIDTH = 360;
const LOSS_HEIGHT = 140;
const DOMAIN = { min: -4, max: 4 };
const GRID_RESOLUTION = 80;
const VIEWPORT: Viewport = { xMin: DOMAIN.min, xMax: DOMAIN.max, yMin: DOMAIN.min, yMax: DOMAIN.max };

const DATASET_LABELS: Record<DatasetType, string> = {
  xor: "XOR clusters",
  moons: "Two moons",
  rings: "Rings",
  drawn: "Drawn points",
  csv: "Imported CSV",
};

/**
 * Issue #253's multi-class categorical palette -- one entry per label up to
 * `MAX_CLASSES`, shared by the scatter points (full color, via `classColor`)
 * and, via `classBackgroundColor`'s pale tint, the multi-class decision-
 * boundary background (so the full-color point markers stay visually
 * distinct from the region they sit in). Index 0/1 are the same blue/red
 * the original binary scatter always used, so a 2-class "drawn"/"csv"
 * dataset looks unchanged.
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

function classColor(cls: number): string {
  const [r, g, b] = CLASS_COLORS[cls % CLASS_COLORS.length]!;
  return `rgb(${r}, ${g}, ${b})`;
}

/** A pale tint of `classColor(cls)` -- blended toward white by `amount` (0 = full color, 1 = white) -- for the multi-class boundary's background regions. */
function classBackgroundColor(cls: number, amount = 0.75): [number, number, number] {
  const [r, g, b] = CLASS_COLORS[cls % CLASS_COLORS.length]!;
  return [Math.round(r + (255 - r) * amount), Math.round(g + (255 - g) * amount), Math.round(b + (255 - b) * amount)];
}

/** `classNames[cls]` when present (issue #253's CSV import, which carries the original column text through) -- falling back to a generic "class N" label for drawn/generated datasets. */
function classLabel(cls: number, classNames: readonly string[]): string {
  return classNames[cls] ?? `class ${cls}`;
}

function seedState(graph: CellGraph, ids: CellIdsMlPlayground, state: MlPlaygroundState): void {
  graph.set(ids.dataset, state.dataset);
  graph.set(ids.pointsPerClass, state.pointsPerClass);
  graph.set(ids.dataSeed, state.dataSeed);
  graph.set(ids.modelSeed, state.modelSeed);
  graph.set(ids.hidden, state.hidden);
  graph.set(ids.lr, state.lr);
  graph.set(ids.epochs, state.epochs);
  graph.set(ids.dropout, state.dropout);
  graph.set(ids.useSchedule, state.useSchedule ?? DEFAULT_ML_PLAYGROUND_STATE.useSchedule);
  graph.set(ids.stepSize, state.stepSize ?? DEFAULT_ML_PLAYGROUND_STATE.stepSize);
  graph.set(ids.gamma, state.gamma ?? DEFAULT_ML_PLAYGROUND_STATE.gamma);
  // Issue #253's CSV-import dataset: unlike drawnPoints (added one click at
  // a time, deliberately kept OUT of the URL schema, seeded separately
  // below), an import is one bulk action worth persisting the same way as
  // every other config field here -- see ml-playground-state.ts's own doc
  // comment on csvPoints/classNames.
  graph.set(ids.csvPoints, state.csvPoints ?? []);
  graph.set(ids.classNames, state.classNames ?? []);
}

function getCurrentState(graph: CellGraph, ids: CellIdsMlPlayground): MlPlaygroundState {
  return {
    v: 3,
    dataset: graph.get<DatasetType>(ids.dataset),
    pointsPerClass: graph.get<string>(ids.pointsPerClass),
    dataSeed: graph.get<string>(ids.dataSeed),
    modelSeed: graph.get<string>(ids.modelSeed),
    hidden: graph.get<string>(ids.hidden),
    lr: graph.get<string>(ids.lr),
    epochs: graph.get<string>(ids.epochs),
    dropout: graph.get<string>(ids.dropout),
    useSchedule: graph.get<boolean>(ids.useSchedule),
    stepSize: graph.get<string>(ids.stepSize),
    gamma: graph.get<string>(ids.gamma),
    csvPoints: graph.get<LabeledPoint[]>(ids.csvPoints),
    classNames: graph.get<string[]>(ids.classNames),
  };
}

function useMlGraph(cellId: string): CellGraph {
  const ref = useRef<CellGraph | null>(null);
  if (!ref.current) {
    const graph = new CellGraph();
    const ids = cellIdsMlPlayground(cellId);
    const decoded = typeof window !== "undefined" ? decodeMlPlaygroundState(window.location.hash.slice(1)) : null;
    seedState(graph, ids, decoded ?? DEFAULT_ML_PLAYGROUND_STATE);
    // User-drawn points (issue #34's "drawn" dataset) are ephemeral UI
    // state, not part of the URL-codable schema (unlike every other config
    // input here) -- same reasoning as TIME_CELL: auxiliary, seeded once.
    if (!graph.has(ids.drawnPoints)) graph.set(ids.drawnPoints, [] as LabeledPoint[], { auxiliary: true });
    // Live training-observation cells (issue #34 item 2) -- written mid-run
    // by handleTrain's mallory-telemetry sink, so an agent (via
    // useCellGraphTools) or a human (via the Objects list) can watch an
    // in-progress run, not just the final result. Seeded once, same as
    // drawnPoints above.
    if (!graph.has(ids.isTraining)) graph.set(ids.isTraining, false, { auxiliary: true });

    graph.define(ids.points, (): Result<LabeledPoint[]> => {
      try {
        const dataset = graph.get<DatasetType>(ids.dataset);
        if (dataset === "drawn") return { ok: true, value: graph.get<LabeledPoint[]>(ids.drawnPoints) };
        // Issue #253: the imported-CSV dataset reads straight from
        // mlCsvPoints, the same "bypass generateDataset entirely" pattern
        // "drawn" already established above.
        if (dataset === "csv") return { ok: true, value: graph.get<LabeledPoint[]>(ids.csvPoints) };
        const pointsPerClass = Number(graph.get<string>(ids.pointsPerClass));
        const seed = Number(graph.get<string>(ids.dataSeed));
        if (Number.isNaN(pointsPerClass) || Number.isNaN(seed)) throw new Error("Points per class and data seed must be numbers.");
        return { ok: true, value: generateDataset(dataset, pointsPerClass, seed) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    ref.current = graph;
  }
  return ref.current;
}

/** Blue (P~0) through white (P=0.5) to red (P~1) -- the standard playground diverging scale, mapped ABSOLUTELY over [0,1] (not min/max-normalized: a confidently-one-sided model should look one-sided). */
function probabilityColor(p: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, p));
  if (t < 0.5) {
    const u = t / 0.5;
    return [Math.round(96 + u * 159), Math.round(148 + u * 107), 255];
  }
  const u = (t - 0.5) / 0.5;
  return [255, Math.round(255 - u * 155), Math.round(255 - u * 159)];
}

/**
 * The ML playground (issue #34 item 1): a tiny seeded 2->hidden->N MLP
 * trained in-browser on toy datasets via the family's own trainer.fit +
 * optim.Adam + nn.binaryCrossEntropy/nn.crossEntropy, with the decision
 * boundary rendered under the data scatter (a continuous probability
 * heatmap for 2 classes, a categorical region map for 3+, issue #253) and a
 * per-epoch loss curve. Training is IMPERATIVE (the Train button mutates
 * the model's weights in place; Train again continues from there; Reset
 * re-seeds) -- deliberately not a derived cell, which would silently
 * retrain on every keystroke and destroy the accumulated weights. Config
 * inputs stay cells (URL-codable, agent-drivable); the trained model lives
 * in a ref.
 *
 * The telemetry->CellGraph metric-sink handshake (issue #34 item 2, the
 * ticket's "novel part") and the regression panel's Huber option (item 3)
 * are already built. Issue #253 added: an imported-CSV dataset (see
 * DataImportPanel.tsx's "Open in ML" handoff), support for more than 2
 * labels ("drawn" and "csv" datasets), and folding this panel's tab-mate
 * DigitClassifierPanel into the same `/ml` route (see ml.tsx).
 */
/**
 * Pure re-render of the decision-boundary canvas, extracted from the draw
 * effect below so `PngExportButton`'s `renderAtScale` (issue #278) can
 * call it against a fresh offscreen canvas at any size.
 */
export function drawMlBoundaryPanel(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  boundaryGrid: { kind: "probability" | "class"; grid: number[][] } | null,
  pointsResult: Result<LabeledPoint[]>,
): void {
  ctx.clearRect(0, 0, width, height);
  if (boundaryGrid) {
    const image = ctx.createImageData(width, height);
    const resolution = boundaryGrid.grid.length;
    for (let py = 0; py < height; py++) {
      // Canvas y grows downward; grid row 0 is the domain's MIN y, so flip.
      const gy = Math.min(resolution - 1, Math.floor(((height - 1 - py) / height) * resolution));
      for (let px = 0; px < width; px++) {
        const gx = Math.min(resolution - 1, Math.floor((px / width) * resolution));
        const cell = boundaryGrid.grid[gy]![gx]!;
        const [r, g, b] = boundaryGrid.kind === "probability" ? probabilityColor(cell) : classBackgroundColor(cell);
        const idx = (py * width + px) * 4;
        image.data[idx] = r;
        image.data[idx + 1] = g;
        image.data[idx + 2] = b;
        image.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  }
  drawAxes(ctx, VIEWPORT, width, height);
  if (pointsResult.ok) {
    const byClass = new Map<number, LabeledPoint[]>();
    for (const p of pointsResult.value) {
      const bucket = byClass.get(p.label);
      if (bucket) bucket.push(p);
      else byClass.set(p.label, [p]);
    }
    for (const [cls, pts] of [...byClass.entries()].sort((a, b) => a[0] - b[0])) {
      drawScatter(ctx, pts, VIEWPORT, width, height, 3, classColor(cls));
    }
  }
}

/**
 * Pure re-render of the training-loss canvas, extracted from the draw
 * effect below so `PngExportButton`'s `renderAtScale` (issue #278) can
 * call it against a fresh offscreen canvas at any size.
 */
export function drawMlLossPanel(ctx: CanvasRenderingContext2D, width: number, height: number, lossHistory: number[]): void {
  ctx.clearRect(0, 0, width, height);
  if (lossHistory.length < 2) return;
  const maxLoss = Math.max(...lossHistory);
  const viewport: Viewport = { xMin: 0, xMax: lossHistory.length - 1, yMin: 0, yMax: maxLoss * 1.05 };
  drawAxes(ctx, viewport, width, height);
  drawPolyline(ctx, lossHistory.map((loss, i) => ({ x: i, y: loss })), viewport, width, height, "#dc2626");
}

export function MlPlaygroundPanel({ cellId = "ml-1" }: { cellId?: string } = {}) {
  const graph = useMlGraph(cellId);
  useCellGraphTools(`ml_${cellId}`, graph);
  const ids = cellIdsMlPlayground(cellId);
  const boundaryCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lossCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const modelRef = useRef<TinyMlp | null>(null);

  const dataset = useCell<DatasetType>(graph, ids.dataset);
  const pointsPerClass = useCell<string>(graph, ids.pointsPerClass);
  const dataSeed = useCell<string>(graph, ids.dataSeed);
  const modelSeed = useCell<string>(graph, ids.modelSeed);
  const hidden = useCell<string>(graph, ids.hidden);
  const lr = useCell<string>(graph, ids.lr);
  const epochs = useCell<string>(graph, ids.epochs);
  const dropout = useCell<string>(graph, ids.dropout);
  const useSchedule = useCell<boolean>(graph, ids.useSchedule);
  const stepSize = useCell<string>(graph, ids.stepSize);
  const gamma = useCell<string>(graph, ids.gamma);
  const pointsResult = useCell<Result<LabeledPoint[]>>(graph, ids.points);
  const isTrainingCell = useCell<boolean>(graph, ids.isTraining);
  const liveLoss = useCell<number | undefined>(graph, ids.metric("loss"));
  const classNames = useCell<string[]>(graph, ids.classNames);

  const [lossHistory, setLossHistory] = useState<number[]>([]);
  const [boundaryGrid, setBoundaryGrid] = useState<{ kind: "probability" | "class"; grid: number[][] } | null>(null);
  const [trainError, setTrainError] = useState<string | null>(null);
  const [training, setTraining] = useState(false);
  const [totalEpochs, setTotalEpochs] = useState(0);
  // Which class a click adds to drawing mode -- ephemeral UI state, not a
  // cell (like `training`/`trainError` above), since it's not part of the
  // dataset itself.
  const [drawLabel, setDrawLabel] = useState(0);
  // How many label buttons the "drawn" dataset's UI offers (issue #253's
  // "more than two labels") -- ephemeral, like drawLabel above; the
  // MODEL's actual numClasses (below) is derived from whichever labels the
  // user has actually clicked, not from this count, so lowering it never
  // strands already-drawn higher-numbered points.
  const [drawClassCount, setDrawClassCount] = useState(2);

  // Issue #253: the model's output width is derived from whatever labels
  // are actually present in the current dataset -- xor/moons/rings always
  // produce exactly 0/1 (unaffected), while "drawn"/"csv" can produce more.
  const numClasses = useMemo(() => (pointsResult.ok ? inferNumClasses(pointsResult.value) : 2), [pointsResult]);

  // Changing the architecture, its seed, the dropout rate, or the number of
  // classes invalidates the current weights -- the next Train starts from a
  // fresh seeded init rather than silently continuing a model whose config
  // no longer matches the inputs (a dropout-rate change in particular would
  // otherwise leave the old model's `nn.Dropout` layer stale, still using
  // the previous rate; a numClasses change would leave the output layer the
  // wrong width entirely).
  const modelKey = useMemo(() => `${hidden}:${modelSeed}:${dropout}:${numClasses}`, [hidden, modelSeed, dropout, numClasses]);
  useEffect(() => {
    modelRef.current = null;
    setLossHistory([]);
    setBoundaryGrid(null);
    setTotalEpochs(0);
  }, [modelKey]);

  // subscribeMany (not subscribeAll, issue #235) -- getCurrentState only
  // reads the fixed config cell list below, never ids.isTraining,
  // ids.drawnPoints, or a per-epoch ids.metric(name) cell, so a
  // subscribeAll here used to re-run writeUrl on every single training-loop
  // epoch (installMetricSink's per-epoch graph.set below) even though the
  // URL never encodes live training progress at all. ids.csvPoints/
  // ids.classNames ARE included (issue #253) -- a CSV import is one bulk
  // `graph.set`, not a per-click stream, so it's fine (and desired,
  // matching every other config field) for it to trigger a URL rewrite.
  useEffect(() => {
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeMlPlaygroundState(getCurrentState(graph, ids))}`);
    }
    writeUrl();
    return graph.subscribeMany(
      [
        ids.dataset,
        ids.pointsPerClass,
        ids.dataSeed,
        ids.modelSeed,
        ids.hidden,
        ids.lr,
        ids.epochs,
        ids.dropout,
        ids.useSchedule,
        ids.stepSize,
        ids.gamma,
        ids.csvPoints,
        ids.classNames,
      ],
      writeUrl,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  // Issue #34 item 2's "novel part": mallory-telemetry's setSink/metric
  // handshake as the reactive bridge from an in-progress training run into
  // CellGraph, so the loss curve becomes just another live cell an agent
  // (or the Objects list) can watch mid-run -- not just the final,
  // post-completion result handleTrain used to write. `runId` scopes each
  // call's sink to its own events (setSink is global/single-installed, and
  // this panel is cellId-parameterized, so a stray event from a different
  // MlPlaygroundPanel instance's run must never write into this one's cells).
  async function handleTrain() {
    if (!pointsResult.ok || training) return;
    setTraining(true);
    graph.set(ids.isTraining, true, { auxiliary: true });
    setTrainError(null);
    const runId = crypto.randomUUID();
    const startingEpoch = totalEpochs;
    const uninstallSink = installMetricSink(runId, (name, value) => {
      graph.set(ids.metric(name), value, { auxiliary: true });
    });
    try {
      if (!modelRef.current) {
        modelRef.current = new TinyMlp(Number(hidden), Number(modelSeed), Number(dropout), numClasses);
      }
      const schedule = useSchedule ? { stepSize: Number(stepSize), gamma: Number(gamma) } : undefined;
      const result = await trainModel(modelRef.current, pointsResult.value, Number(lr), Number(epochs), schedule, async ({ epoch, loss }) => {
        metric(runId, startingEpoch + epoch, "loss", loss);
        setLossHistory((prev) => [...prev, loss]);
        // Yields a real animation-frame boundary (not just a microtask, which
        // `await`ing an already-resolved promise would give) so the browser
        // actually paints the updated loss cell/curve between epochs, and an
        // agent polling via get_cell has a genuine window to observe it.
        await new Promise((resolve) => {
          // Falls back to a macrotask when requestAnimationFrame isn't available
          // (SSR/no-DOM test environments) -- the yield itself is what matters
          // here, not which scheduling primitive provides it.
          if (typeof requestAnimationFrame === "function") requestAnimationFrame(resolve);
          else setTimeout(resolve, 0);
        });
      });
      setTotalEpochs((prev) => prev + result.lossHistory.length);
      // Issue #253: numClasses===2 keeps the original continuous P(label=1)
      // heatmap; 3+ classes has no such continuous equivalent, so it uses
      // predictClassGrid's per-cell argmax class instead (see
      // classBackgroundColor's categorical rendering below).
      setBoundaryGrid(
        modelRef.current.numClasses === 2
          ? { kind: "probability", grid: predictProbabilityGrid(modelRef.current, DOMAIN, GRID_RESOLUTION) }
          : { kind: "class", grid: predictClassGrid(modelRef.current, DOMAIN, GRID_RESOLUTION) },
      );
    } catch (e) {
      setTrainError(e instanceof Error ? e.message : String(e));
    } finally {
      uninstallSink();
      graph.set(ids.isTraining, false, { auxiliary: true });
      setTraining(false);
    }
  }

  function handleReset() {
    modelRef.current = null;
    setLossHistory([]);
    setBoundaryGrid(null);
    setTrainError(null);
    setTotalEpochs(0);
  }

  // Click-to-add-labeled-point (issue #34's "drawn" dataset). Only active
  // in drawn mode -- the other datasets' scatter is read-only. `drawLabel`
  // (issue #253) can now be any of `drawClassCount`'s radio buttons, not
  // just 0/1.
  function handleCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (dataset !== "drawn") return;
    const canvas = boundaryCanvasRef.current;
    if (!canvas) return;
    const { sx, sy } = canvasEventPoint(e, canvas, BOUNDARY_SIZE, BOUNDARY_SIZE);
    const x = toDataX(sx, VIEWPORT, BOUNDARY_SIZE);
    const y = toDataY(sy, VIEWPORT, BOUNDARY_SIZE);
    const current = graph.get<LabeledPoint[]>(ids.drawnPoints);
    graph.set(ids.drawnPoints, [...current, { x, y, label: drawLabel }]);
  }

  function handleClearDrawnPoints() {
    graph.set(ids.drawnPoints, []);
  }

  // Issue #253: lets a CSV import be re-done from a clean slate (mirrors
  // "Clear drawn points" above) without leaving the panel showing a mix of
  // an old dataset's points/classNames if a fresh import were skipped.
  function handleClearCsvPoints() {
    graph.set(ids.csvPoints, []);
    graph.set(ids.classNames, []);
  }

  useEffect(() => {
    const ctx = boundaryCanvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawMlBoundaryPanel(ctx, BOUNDARY_SIZE, BOUNDARY_SIZE, boundaryGrid, pointsResult);
  }, [boundaryGrid, pointsResult]);

  useEffect(() => {
    const ctx = lossCanvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawMlLossPanel(ctx, LOSS_WIDTH, LOSS_HEIGHT, lossHistory);
  }, [lossHistory]);

  const lastLoss = lossHistory[lossHistory.length - 1];

  return (
    <div>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <label>
          dataset:{" "}
          <select value={dataset} onChange={(e) => graph.set(ids.dataset, e.target.value as DatasetType)}>
            {(Object.keys(DATASET_LABELS) as DatasetType[]).map((t) => (
              <option key={t} value={t}>
                {DATASET_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        {dataset === "drawn" ? (
          <>
            <label style={{ fontSize: "0.85rem" }}>
              classes:{" "}
              <input
                type="number"
                min={2}
                max={MAX_CLASSES}
                value={drawClassCount}
                onChange={(e) => {
                  const n = Math.max(2, Math.min(MAX_CLASSES, Number(e.target.value) || 2));
                  setDrawClassCount(n);
                  if (drawLabel >= n) setDrawLabel(0);
                }}
                style={{ font: "inherit", width: "4ch" }}
              />
            </label>
            <span style={{ fontSize: "0.85rem" }}>
              draw:{" "}
              {Array.from({ length: drawClassCount }, (_, cls) => (
                <label key={cls} style={{ color: classColor(cls) }}>
                  <input type="radio" name={`${cellId}-draw-label`} checked={drawLabel === cls} onChange={() => setDrawLabel(cls)} /> class {cls}{" "}
                </label>
              ))}
            </span>
            <button type="button" onClick={handleClearDrawnPoints}>
              Clear drawn points
            </button>
          </>
        ) : dataset === "csv" ? (
          <>
            <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
              {pointsResult.ok && pointsResult.value.length > 0
                ? `${pointsResult.value.length} point${pointsResult.value.length === 1 ? "" : "s"} imported, ${numClasses} class${numClasses === 1 ? "" : "es"}`
                : 'No CSV imported yet -- use "Open in ML" on the Data → Import tab.'}
            </span>
            <button type="button" onClick={handleClearCsvPoints} disabled={!pointsResult.ok || pointsResult.value.length === 0}>
              Clear imported points
            </button>
          </>
        ) : (
          <>
            <label>
              points/class:{" "}
              <input
                type="number"
                min={1}
                max={500}
                value={pointsPerClass}
                onChange={(e) => graph.set(ids.pointsPerClass, e.target.value)}
                style={{ font: "inherit", width: "6ch" }}
              />
            </label>
            <label>
              data seed:{" "}
              <input value={dataSeed} onChange={(e) => graph.set(ids.dataSeed, e.target.value)} style={{ font: "inherit", width: "6ch" }} />
            </label>
          </>
        )}
      </div>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <label>
          hidden units:{" "}
          <input
            type="number"
            min={1}
            max={64}
            value={hidden}
            onChange={(e) => graph.set(ids.hidden, e.target.value)}
            style={{ font: "inherit", width: "6ch" }}
          />
        </label>
        <label>
          model seed:{" "}
          <input value={modelSeed} onChange={(e) => graph.set(ids.modelSeed, e.target.value)} style={{ font: "inherit", width: "6ch" }} />
        </label>
        <label>
          lr: <input value={lr} onChange={(e) => graph.set(ids.lr, e.target.value)} style={{ font: "inherit", width: "7ch" }} />
        </label>
        <label>
          epochs:{" "}
          <input
            type="number"
            min={1}
            max={2000}
            value={epochs}
            onChange={(e) => graph.set(ids.epochs, e.target.value)}
            style={{ font: "inherit", width: "7ch" }}
          />
        </label>
        <label>
          dropout:{" "}
          <input
            type="number"
            min={0}
            max={0.9}
            step={0.05}
            value={dropout}
            onChange={(e) => graph.set(ids.dropout, e.target.value)}
            style={{ font: "inherit", width: "6ch" }}
          />
        </label>
        <button type="button" onClick={handleTrain} disabled={training || !pointsResult.ok}>
          {training ? "Training…" : totalEpochs > 0 ? "Train more" : "Train"}
        </button>
        <button type="button" onClick={handleReset} disabled={training}>
          Reset
        </button>
      </div>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <label>
          <input type="checkbox" checked={useSchedule} onChange={(e) => graph.set(ids.useSchedule, e.target.checked)} /> StepLR schedule
        </label>
        {useSchedule && (
          <>
            <label>
              step size:{" "}
              <input
                type="number"
                min={1}
                value={stepSize}
                onChange={(e) => graph.set(ids.stepSize, e.target.value)}
                style={{ font: "inherit", width: "6ch" }}
              />
            </label>
            <label>
              gamma: <input value={gamma} onChange={(e) => graph.set(ids.gamma, e.target.value)} style={{ font: "inherit", width: "6ch" }} />
            </label>
          </>
        )}
      </div>
      {!pointsResult.ok && <p style={{ color: "var(--danger)" }}>{pointsResult.message}</p>}
      {trainError && <p style={{ color: "var(--danger)" }}>{trainError}</p>}
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <div>
          <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>
            Decision boundary ({numClasses === 2 ? "blue = class 0, red = class 1" : `${numClasses} classes, see legend below`})
            {dataset === "drawn" ? " -- click to add a point" : ""}
          </p>
          {numClasses > 2 && (
            <p style={{ fontSize: "0.8rem", margin: "0.25rem 0", display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
              {Array.from({ length: numClasses }, (_, cls) => (
                <span key={cls} style={{ color: classColor(cls) }}>
                  ● {classLabel(cls, classNames)}
                </span>
              ))}
            </p>
          )}
          <canvas
            ref={boundaryCanvasRef}
            width={BOUNDARY_SIZE}
            height={BOUNDARY_SIZE}
            onClick={handleCanvasClick}
            style={{ border: "1px solid var(--border)", maxWidth: "100%", cursor: dataset === "drawn" ? "crosshair" : "default" }}
          />
          <div style={{ margin: "0.25rem 0" }}>
            <PngExportButton
              getCanvas={() => boundaryCanvasRef.current}
              label="ml-decision-boundary"
              renderAtScale={(ctx, width, height) => drawMlBoundaryPanel(ctx, width, height, boundaryGrid, pointsResult)}
              baseWidth={BOUNDARY_SIZE}
              baseHeight={BOUNDARY_SIZE}
            />
          </div>
        </div>
        <div>
          <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>
            Loss{totalEpochs > 0 ? ` -- ${totalEpochs} epochs, last ${lastLoss?.toExponential(3)}` : ""}
            {isTrainingCell && liveLoss !== undefined ? ` (live: ${liveLoss.toExponential(3)})` : ""}
          </p>
          <canvas ref={lossCanvasRef} width={LOSS_WIDTH} height={LOSS_HEIGHT} style={{ border: "1px solid var(--border)", maxWidth: "100%" }} />
          <div style={{ margin: "0.25rem 0" }}>
            <PngExportButton
              getCanvas={() => lossCanvasRef.current}
              label="ml-loss"
              renderAtScale={(ctx, width, height) => drawMlLossPanel(ctx, width, height, lossHistory)}
              baseWidth={LOSS_WIDTH}
              baseHeight={LOSS_HEIGHT}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
