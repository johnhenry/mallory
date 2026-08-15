import { useEffect, useRef, useState } from "react";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsFourier, type CellIdsFourier } from "../lib/cell-ids.ts";
import {
  DEFAULT_FOURIER_STATE,
  decodeFourierState,
  encodeFourierState,
  type FourierState,
} from "../lib/fourier-state.ts";
import { sampleFourierPartialSum, type FourierWaveType } from "../lib/fourier-series.ts";
import { drawAxes, drawPolyline, type Viewport } from "../lib/render-path.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useCell } from "../lib/use-cell.ts";
import { PngExportButton } from "./PngExportButton.tsx";

const WIDTH = 600;
const HEIGHT = 300;
const SAMPLE_COUNT = 400;
const X_RANGE = 2 * Math.PI;
const VIEWPORT: Viewport = { xMin: -X_RANGE, xMax: X_RANGE, yMin: -1.4, yMax: 1.4 };

function seedFourierState(graph: CellGraph, ids: CellIdsFourier, state: FourierState): void {
  graph.set(ids.waveType, state.waveType);
  graph.set(ids.harmonics, state.harmonics);
}

function getCurrentFourierState(graph: CellGraph, ids: CellIdsFourier): FourierState {
  return {
    v: 1,
    waveType: graph.get<FourierWaveType>(ids.waveType),
    harmonics: graph.get<string>(ids.harmonics),
  };
}

type SamplesResult =
  | { ok: true; value: ReturnType<typeof sampleFourierPartialSum> }
  | { ok: false; message: string };

function useFourierGraph(cellId: string): CellGraph {
  const ref = useRef<CellGraph | null>(null);
  if (!ref.current) {
    const graph = new CellGraph();
    const ids = cellIdsFourier(cellId);
    const decoded = typeof window !== "undefined" ? decodeFourierState(window.location.hash.slice(1)) : null;
    seedFourierState(graph, ids, decoded ?? DEFAULT_FOURIER_STATE);

    graph.define(ids.samples, (): SamplesResult => {
      try {
        const waveType = graph.get<FourierWaveType>(ids.waveType);
        const harmonicsText = graph.get<string>(ids.harmonics);
        const harmonics = Number(harmonicsText);
        if (!Number.isFinite(harmonics) || !Number.isInteger(harmonics)) throw new Error("Harmonics must be a whole number.");
        if (harmonics < 0) throw new Error("Harmonics must be zero or a positive integer.");
        if (harmonics > 500) throw new Error("Harmonics is capped at 500 -- higher counts don't change the picture, just the compute cost.");
        return { ok: true, value: sampleFourierPartialSum(waveType, harmonics, VIEWPORT.xMin, VIEWPORT.xMax, SAMPLE_COUNT) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    ref.current = graph;
  }
  return ref.current;
}

/**
 * Classic square/sawtooth wave Fourier partial sums (issue #26's last
 * remaining item), demonstrating the Gibbs phenomenon: as `harmonics`
 * grows, the partial sum (solid) hugs the true wave (dashed) more closely
 * away from a jump discontinuity, but the OVERSHOOT right at a jump does
 * not shrink -- it just narrows toward the discontinuity, converging to a
 * fixed ~9% overshoot rather than vanishing.
 */
export function FourierPanel({ cellId = "fourier-1" }: { cellId?: string } = {}) {
  const graph = useFourierGraph(cellId);
  useCellGraphTools(`calculus_fourier_${cellId}`, graph);
  const ids = cellIdsFourier(cellId);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const waveType = useCell<FourierWaveType>(graph, ids.waveType);
  const harmonics = useCell<string>(graph, ids.harmonics);
  const samples = useCell<SamplesResult>(graph, ids.samples);

  const [harmonicsInput, setHarmonicsInput] = useState(harmonics);
  useEffect(() => {
    setHarmonicsInput(harmonics);
  }, [harmonics]);

  useEffect(() => {
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeFourierState(getCurrentFourierState(graph, ids))}`);
    }
    writeUrl();
    return graph.subscribeAll(writeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    drawAxes(ctx, VIEWPORT, WIDTH, HEIGHT);
    if (!samples.ok) return;
    ctx.save();
    ctx.strokeStyle = "var(--muted)";
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    samples.value.target.forEach((p, i) => {
      // The target wave jumps discontinuously -- a straight connecting line
      // across a jump would draw a fake vertical edge that isn't part of
      // the actual step function, so a large y-gap between adjacent samples
      // starts a new subpath instead of a lineTo.
      const prev = samples.value.target[i - 1];
      const sx = ((p.x - VIEWPORT.xMin) / (VIEWPORT.xMax - VIEWPORT.xMin)) * WIDTH;
      const sy = HEIGHT - ((p.y - VIEWPORT.yMin) / (VIEWPORT.yMax - VIEWPORT.yMin)) * HEIGHT;
      if (i === 0 || (prev && Math.abs(p.y - prev.y) > 0.5)) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.stroke();
    ctx.restore();
    drawPolyline(ctx, samples.value.partial, VIEWPORT, WIDTH, HEIGHT, "#2563eb");
  }, [samples]);

  return (
    <div>
      <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>
        Truncated Fourier series (solid) vs. the true wave (dashed) -- watch the overshoot near each jump stay put as harmonics
        grows (the Gibbs phenomenon).
      </p>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <label>
          wave:{" "}
          <select value={waveType} onChange={(e) => graph.set(ids.waveType, e.target.value as FourierWaveType)}>
            <option value="square">square</option>
            <option value="sawtooth">sawtooth</option>
          </select>
        </label>
        <label>
          harmonics:{" "}
          <input
            type="number"
            min={0}
            max={500}
            value={harmonicsInput}
            onChange={(e) => {
              setHarmonicsInput(e.target.value);
              graph.set(ids.harmonics, e.target.value);
            }}
            style={{ font: "inherit", width: "6ch" }}
          />
        </label>
      </div>
      <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} style={{ border: "1px solid var(--border)" }} />
      <div style={{ margin: "0.25rem 0" }}>
        <PngExportButton getCanvas={() => canvasRef.current} label="fourier" />
      </div>
      {!samples.ok && <p style={{ color: "var(--danger)" }}>{samples.message}</p>}
    </div>
  );
}
