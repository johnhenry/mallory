import { useEffect, useRef } from "react";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsSignal, type CellIdsSignal } from "../lib/cell-ids.ts";
import { DEFAULT_SIGNAL_STATE, decodeSignalState, encodeSignalState, type SignalState } from "../lib/signal-state.ts";
import { amplitudeSpectrum, sampleWaveform, type AmplitudeSpectrum, type Waveform } from "../lib/signal-waveform.ts";
import { drawPolyline } from "../lib/render-path.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useCell } from "../lib/use-cell.ts";
import type { Viewport } from "../lib/viewport.ts";

type Result<T> = { ok: true; value: T } | { ok: false; message: string };

const WAVEFORM_WIDTH = 640;
const WAVEFORM_HEIGHT = 220;
const SPECTRUM_WIDTH = 640;
const SPECTRUM_HEIGHT = 220;

function seedSignalState(graph: CellGraph, ids: CellIdsSignal, state: SignalState): void {
  graph.set(ids.exprText, state.exprText);
  graph.set(ids.sampleRate, state.sampleRate);
  graph.set(ids.duration, state.duration);
}

function getCurrentSignalState(graph: CellGraph, ids: CellIdsSignal): SignalState {
  return {
    v: 1,
    exprText: graph.get<string>(ids.exprText),
    sampleRate: graph.get<string>(ids.sampleRate),
    duration: graph.get<string>(ids.duration),
  };
}

/**
 * Sets up the signal panel's reactive cells on its own private CellGraph --
 * a waveform + its FFT spectrum as one reactive chain (the ticket's
 * "flagship" framing), which doesn't fit `cellIds`/GraphCanvas's
 * single-real-curve shape.
 */
function useSignalGraph(cellId: string): CellGraph {
  const ref = useRef<CellGraph | null>(null);
  if (!ref.current) {
    const graph = new CellGraph();
    const ids = cellIdsSignal(cellId);
    const decoded = typeof window !== "undefined" ? decodeSignalState(window.location.hash.slice(1)) : null;
    seedSignalState(graph, ids, decoded ?? DEFAULT_SIGNAL_STATE);

    graph.define(ids.waveformResult, (): Result<Waveform> => {
      try {
        const exprText = graph.get<string>(ids.exprText);
        const sampleRate = Number(graph.get<string>(ids.sampleRate));
        const duration = Number(graph.get<string>(ids.duration));
        if (Number.isNaN(sampleRate) || Number.isNaN(duration)) throw new Error("Sample rate and duration must both be numbers.");
        return { ok: true, value: sampleWaveform(exprText, sampleRate, duration) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    graph.define(ids.spectrumResult, (): Result<AmplitudeSpectrum> => {
      const waveform = graph.get<Result<Waveform>>(ids.waveformResult);
      if (!waveform.ok) return waveform;
      try {
        return { ok: true, value: amplitudeSpectrum(waveform.value) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    ref.current = graph;
  }
  return ref.current;
}

/**
 * v1 of the signal panel (part of #31): compose f(t), see its waveform, and
 * see its one-sided amplitude spectrum via `mallory-fft`'s `rfft` -- the
 * CAS-correctness-heavy core of the ticket's pipeline. Spectrogram, filter
 * design/Bode plot, PSD, cross-correlation, and Phase 2 live audio are
 * deferred (see the trimmed issue body).
 */
export function SignalPanel({ cellId = "signal-1" }: { cellId?: string } = {}) {
  const graph = useSignalGraph(cellId);
  useCellGraphTools(`signal_${cellId}`, graph);
  const ids = cellIdsSignal(cellId);
  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const spectrumCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const exprText = useCell<string>(graph, ids.exprText);
  const sampleRate = useCell<string>(graph, ids.sampleRate);
  const duration = useCell<string>(graph, ids.duration);
  const waveformResult = useCell<Result<Waveform>>(graph, ids.waveformResult);
  const spectrumResult = useCell<Result<AmplitudeSpectrum>>(graph, ids.spectrumResult);

  useEffect(() => {
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeSignalState(getCurrentSignalState(graph, ids))}`);
    }
    writeUrl();
    return graph.subscribeAll(writeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  useEffect(() => {
    const canvas = waveformCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, WAVEFORM_WIDTH, WAVEFORM_HEIGHT);
    if (!waveformResult.ok) return;
    const { t, y } = waveformResult.value;
    const maxAbsY = Math.max(1e-9, ...y.map((v) => Math.abs(v)));
    const viewport: Viewport = { xMin: t[0]!, xMax: t[t.length - 1]!, yMin: -maxAbsY * 1.1, yMax: maxAbsY * 1.1 };
    const points = t.map((ti, i) => ({ x: ti, y: y[i]! }));
    drawPolyline(ctx, points, viewport, WAVEFORM_WIDTH, WAVEFORM_HEIGHT);
  }, [waveformResult]);

  useEffect(() => {
    const canvas = spectrumCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, SPECTRUM_WIDTH, SPECTRUM_HEIGHT);
    if (!spectrumResult.ok) return;
    const { frequencies, amplitudes } = spectrumResult.value;
    const maxAmp = Math.max(1e-9, ...amplitudes);
    const viewport: Viewport = { xMin: 0, xMax: frequencies[frequencies.length - 1]!, yMin: 0, yMax: maxAmp * 1.1 };
    const points = frequencies.map((f, i) => ({ x: f, y: amplitudes[i]! }));
    drawPolyline(ctx, points, viewport, SPECTRUM_WIDTH, SPECTRUM_HEIGHT, "#dc2626");
  }, [spectrumResult]);

  return (
    <div>
      <h2>Compose f(t)</h2>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <label>
          f(t) = <input value={exprText} onChange={(e) => graph.set(ids.exprText, e.target.value)} style={{ font: "inherit", width: "28ch" }} />
        </label>
        <label>
          sample rate (Hz):{" "}
          <input
            type="number"
            min={1}
            value={sampleRate}
            onChange={(e) => graph.set(ids.sampleRate, e.target.value)}
            style={{ font: "inherit", width: "8ch" }}
          />
        </label>
        <label>
          duration (s):{" "}
          <input
            type="number"
            min={0}
            step="any"
            value={duration}
            onChange={(e) => graph.set(ids.duration, e.target.value)}
            style={{ font: "inherit", width: "8ch" }}
          />
        </label>
      </div>
      {!waveformResult.ok && <p style={{ color: "crimson" }}>{waveformResult.message}</p>}
      {waveformResult.ok && (
        <p style={{ fontSize: "0.8rem", color: "#5b6b8c" }}>
          {waveformResult.value.y.length} samples ({(waveformResult.value.y.length / waveformResult.value.sampleRate).toFixed(3)}s -- rounded up to a
          power of two).
        </p>
      )}

      <h3>Waveform</h3>
      <canvas ref={waveformCanvasRef} width={WAVEFORM_WIDTH} height={WAVEFORM_HEIGHT} style={{ border: "1px solid #d1d5db", maxWidth: "100%" }} />

      <h3>Amplitude spectrum</h3>
      {!spectrumResult.ok && <p style={{ color: "crimson" }}>{spectrumResult.message}</p>}
      <canvas ref={spectrumCanvasRef} width={SPECTRUM_WIDTH} height={SPECTRUM_HEIGHT} style={{ border: "1px solid #d1d5db", maxWidth: "100%" }} />
    </div>
  );
}
