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
  TinyMlp,
  generateDataset,
  installMetricSink,
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
};

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
}

function getCurrentState(graph: CellGraph, ids: CellIdsMlPlayground): MlPlaygroundState {
  return {
    v: 2,
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
 * The ML playground (issue #34 item 1): a tiny seeded 2->hidden->1 MLP
 * trained in-browser on toy datasets via the family's own trainer.fit +
 * optim.Adam + nn.binaryCrossEntropy, with the decision boundary rendered
 * as a probability heatmap under the data scatter and a per-epoch loss
 * curve. Training is IMPERATIVE (the Train button mutates the model's
 * weights in place; Train again continues from there; Reset re-seeds) --
 * deliberately not a derived cell, which would silently retrain on every
 * keystroke and destroy the accumulated weights. Config inputs stay cells
 * (URL-codable, agent-drivable); the trained model lives in a ref.
 *
 * The telemetry->CellGraph metric-sink handshake (item 2, the ticket's
 * "novel part") and the regression panel's Huber option (item 3) are
 * deferred -- see the trimmed issue.
 */
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

  const [lossHistory, setLossHistory] = useState<number[]>([]);
  const [probabilityGrid, setProbabilityGrid] = useState<number[][] | null>(null);
  const [trainError, setTrainError] = useState<string | null>(null);
  const [training, setTraining] = useState(false);
  const [totalEpochs, setTotalEpochs] = useState(0);
  // Which class a click adds to drawing mode -- ephemeral UI state, not a
  // cell (like `training`/`trainError` above), since it's not part of the
  // dataset itself.
  const [drawLabel, setDrawLabel] = useState<0 | 1>(0);

  // Changing the architecture, its seed, or the dropout rate invalidates the
  // current weights -- the next Train starts from a fresh seeded init rather
  // than silently continuing a model whose config no longer matches the
  // inputs (a dropout-rate change in particular would otherwise leave the
  // old model's `nn.Dropout` layer stale, still using the previous rate).
  const modelKey = useMemo(() => `${hidden}:${modelSeed}:${dropout}`, [hidden, modelSeed, dropout]);
  useEffect(() => {
    modelRef.current = null;
    setLossHistory([]);
    setProbabilityGrid(null);
    setTotalEpochs(0);
  }, [modelKey]);

  // subscribeMany (not subscribeAll, issue #235) -- getCurrentState only
  // reads the fixed config cell list below, never ids.isTraining,
  // ids.drawnPoints, or a per-epoch ids.metric(name) cell, so a
  // subscribeAll here used to re-run writeUrl on every single training-loop
  // epoch (installMetricSink's per-epoch graph.set below) even though the
  // URL never encodes live training progress at all.
  useEffect(() => {
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeMlPlaygroundState(getCurrentState(graph, ids))}`);
    }
    writeUrl();
    return graph.subscribeMany(
      [ids.dataset, ids.pointsPerClass, ids.dataSeed, ids.modelSeed, ids.hidden, ids.lr, ids.epochs, ids.dropout, ids.useSchedule, ids.stepSize, ids.gamma],
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
        modelRef.current = new TinyMlp(Number(hidden), Number(modelSeed), Number(dropout));
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
      setProbabilityGrid(predictProbabilityGrid(modelRef.current, DOMAIN, GRID_RESOLUTION));
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
    setProbabilityGrid(null);
    setTrainError(null);
    setTotalEpochs(0);
  }

  // Click-to-add-labeled-point (issue #34's "drawn" dataset). Only active
  // in drawn mode -- the other datasets' scatter is read-only.
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

  useEffect(() => {
    const ctx = boundaryCanvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, BOUNDARY_SIZE, BOUNDARY_SIZE);
    if (probabilityGrid) {
      const image = ctx.createImageData(BOUNDARY_SIZE, BOUNDARY_SIZE);
      const resolution = probabilityGrid.length;
      for (let py = 0; py < BOUNDARY_SIZE; py++) {
        // Canvas y grows downward; grid row 0 is the domain's MIN y, so flip.
        const gy = Math.min(resolution - 1, Math.floor(((BOUNDARY_SIZE - 1 - py) / BOUNDARY_SIZE) * resolution));
        for (let px = 0; px < BOUNDARY_SIZE; px++) {
          const gx = Math.min(resolution - 1, Math.floor((px / BOUNDARY_SIZE) * resolution));
          const [r, g, b] = probabilityColor(probabilityGrid[gy]![gx]!);
          const idx = (py * BOUNDARY_SIZE + px) * 4;
          image.data[idx] = r;
          image.data[idx + 1] = g;
          image.data[idx + 2] = b;
          image.data[idx + 3] = 255;
        }
      }
      ctx.putImageData(image, 0, 0);
    }
    drawAxes(ctx, VIEWPORT, BOUNDARY_SIZE, BOUNDARY_SIZE);
    if (pointsResult.ok) {
      const class0 = pointsResult.value.filter((p) => p.label === 0);
      const class1 = pointsResult.value.filter((p) => p.label === 1);
      drawScatter(ctx, class0, VIEWPORT, BOUNDARY_SIZE, BOUNDARY_SIZE, 3, "#1d4ed8");
      drawScatter(ctx, class1, VIEWPORT, BOUNDARY_SIZE, BOUNDARY_SIZE, 3, "#b91c1c");
    }
  }, [probabilityGrid, pointsResult]);

  useEffect(() => {
    const ctx = lossCanvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, LOSS_WIDTH, LOSS_HEIGHT);
    if (lossHistory.length < 2) return;
    const maxLoss = Math.max(...lossHistory);
    const viewport: Viewport = { xMin: 0, xMax: lossHistory.length - 1, yMin: 0, yMax: maxLoss * 1.05 };
    drawAxes(ctx, viewport, LOSS_WIDTH, LOSS_HEIGHT);
    drawPolyline(ctx, lossHistory.map((loss, i) => ({ x: i, y: loss })), viewport, LOSS_WIDTH, LOSS_HEIGHT, "#dc2626");
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
            <span style={{ fontSize: "0.85rem" }}>
              draw:{" "}
              <label style={{ color: "#1d4ed8" }}>
                <input type="radio" name={`${cellId}-draw-label`} checked={drawLabel === 0} onChange={() => setDrawLabel(0)} /> class 0
              </label>{" "}
              <label style={{ color: "#b91c1c" }}>
                <input type="radio" name={`${cellId}-draw-label`} checked={drawLabel === 1} onChange={() => setDrawLabel(1)} /> class 1
              </label>
            </span>
            <button type="button" onClick={handleClearDrawnPoints}>
              Clear drawn points
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
            Decision boundary (blue = class 0, red = class 1){dataset === "drawn" ? " -- click to add a point" : ""}
          </p>
          <canvas
            ref={boundaryCanvasRef}
            width={BOUNDARY_SIZE}
            height={BOUNDARY_SIZE}
            onClick={handleCanvasClick}
            style={{ border: "1px solid var(--border)", maxWidth: "100%", cursor: dataset === "drawn" ? "crosshair" : "default" }}
          />
          <div style={{ margin: "0.25rem 0" }}>
            <PngExportButton getCanvas={() => boundaryCanvasRef.current} label="ml-decision-boundary" />
          </div>
        </div>
        <div>
          <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>
            Loss{totalEpochs > 0 ? ` -- ${totalEpochs} epochs, last ${lastLoss?.toExponential(3)}` : ""}
            {isTrainingCell && liveLoss !== undefined ? ` (live: ${liveLoss.toExponential(3)})` : ""}
          </p>
          <canvas ref={lossCanvasRef} width={LOSS_WIDTH} height={LOSS_HEIGHT} style={{ border: "1px solid var(--border)", maxWidth: "100%" }} />
          <div style={{ margin: "0.25rem 0" }}>
            <PngExportButton getCanvas={() => lossCanvasRef.current} label="ml-loss" />
          </div>
        </div>
      </div>
    </div>
  );
}
