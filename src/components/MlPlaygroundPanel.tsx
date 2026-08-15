import { useEffect, useMemo, useRef, useState } from "react";
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
  predictProbabilityGrid,
  trainModel,
  type DatasetType,
  type LabeledPoint,
} from "../lib/ml-playground.ts";
import { drawAxes, drawPolyline, drawScatter } from "../lib/render-path.ts";
import type { Viewport } from "../lib/viewport.ts";
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
  };
}

function useMlGraph(cellId: string): CellGraph {
  const ref = useRef<CellGraph | null>(null);
  if (!ref.current) {
    const graph = new CellGraph();
    const ids = cellIdsMlPlayground(cellId);
    const decoded = typeof window !== "undefined" ? decodeMlPlaygroundState(window.location.hash.slice(1)) : null;
    seedState(graph, ids, decoded ?? DEFAULT_ML_PLAYGROUND_STATE);

    graph.define(ids.points, (): Result<LabeledPoint[]> => {
      try {
        const dataset = graph.get<DatasetType>(ids.dataset);
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
  const pointsResult = useCell<Result<LabeledPoint[]>>(graph, ids.points);

  const [lossHistory, setLossHistory] = useState<number[]>([]);
  const [probabilityGrid, setProbabilityGrid] = useState<number[][] | null>(null);
  const [trainError, setTrainError] = useState<string | null>(null);
  const [training, setTraining] = useState(false);
  const [totalEpochs, setTotalEpochs] = useState(0);

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

  useEffect(() => {
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeMlPlaygroundState(getCurrentState(graph, ids))}`);
    }
    writeUrl();
    return graph.subscribeAll(writeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  async function handleTrain() {
    if (!pointsResult.ok || training) return;
    setTraining(true);
    setTrainError(null);
    try {
      if (!modelRef.current) {
        modelRef.current = new TinyMlp(Number(hidden), Number(modelSeed), Number(dropout));
      }
      const result = await trainModel(modelRef.current, pointsResult.value, Number(lr), Number(epochs));
      setLossHistory((prev) => [...prev, ...result.lossHistory]);
      setTotalEpochs((prev) => prev + result.lossHistory.length);
      setProbabilityGrid(predictProbabilityGrid(modelRef.current, DOMAIN, GRID_RESOLUTION));
    } catch (e) {
      setTrainError(e instanceof Error ? e.message : String(e));
    } finally {
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
      {!pointsResult.ok && <p style={{ color: "var(--danger)" }}>{pointsResult.message}</p>}
      {trainError && <p style={{ color: "var(--danger)" }}>{trainError}</p>}
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <div>
          <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>Decision boundary (blue = class 0, red = class 1)</p>
          <canvas ref={boundaryCanvasRef} width={BOUNDARY_SIZE} height={BOUNDARY_SIZE} style={{ border: "1px solid var(--border)", maxWidth: "100%" }} />
          <div style={{ margin: "0.25rem 0" }}>
            <PngExportButton getCanvas={() => boundaryCanvasRef.current} label="ml-decision-boundary" />
          </div>
        </div>
        <div>
          <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>
            Loss{totalEpochs > 0 ? ` -- ${totalEpochs} epochs, last ${lastLoss?.toExponential(3)}` : ""}
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
