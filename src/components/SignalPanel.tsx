import { useEffect, useRef, useState } from "react";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsSignal, type CellIdsSignal } from "../lib/cell-ids.ts";
import { DEFAULT_SIGNAL_STATE, decodeSignalState, encodeSignalState, type SignalState } from "../lib/signal-state.ts";
import { resolveNaturalLanguageQuery } from "../lib/nl-query.ts";
import {
  amplitudeSpectrum,
  computeSpectrogram,
  drawSpectrogram,
  findSpectrumPeaks,
  sampleWaveform,
  type AmplitudeSpectrum,
  type Spectrogram,
  type SpectrumPeak,
  type Waveform,
} from "../lib/signal-waveform.ts";
import { crossCorrelate, type CorrelationResult } from "../lib/signal-correlation.ts";
import { drawPoint, drawPolyline } from "../lib/render-path.ts";
import { polylineToSvgDocument } from "../lib/svg-export.ts";
import { PngExportButton } from "./PngExportButton.tsx";
import { SvgExportButton } from "./SvgExportButton.tsx";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useCell } from "../lib/use-cell.ts";
import type { Viewport } from "../lib/viewport.ts";

type Result<T> = { ok: true; value: T } | { ok: false; message: string };

interface PlotSeries {
  points: { x: number; y: number }[];
  viewport: Viewport;
}

/** Shared by the Canvas2D draw effect and the SVG export getter, so the viewport math can't drift between the two. */
export function waveformPlot(waveform: Waveform): PlotSeries {
  const { t, y } = waveform;
  const maxAbsY = Math.max(1e-9, ...y.map((v) => Math.abs(v)));
  return {
    points: t.map((ti, i) => ({ x: ti, y: y[i]! })),
    viewport: { xMin: t[0]!, xMax: t[t.length - 1]!, yMin: -maxAbsY * 1.1, yMax: maxAbsY * 1.1 },
  };
}

/** Shared by the Canvas2D draw effect and the SVG export getter, so the viewport math can't drift between the two. */
export function spectrumPlot(spectrum: AmplitudeSpectrum): PlotSeries {
  const { frequencies, amplitudes } = spectrum;
  const maxAmp = Math.max(1e-9, ...amplitudes);
  return {
    points: frequencies.map((f, i) => ({ x: f, y: amplitudes[i]! })),
    viewport: { xMin: 0, xMax: frequencies[frequencies.length - 1]!, yMin: 0, yMax: maxAmp * 1.1 },
  };
}

/** Shared by the Canvas2D draw effect and the SVG export getter, so the viewport math can't drift between the two. */
export function correlationPlot(correlation: CorrelationResult): PlotSeries {
  const { lags, values } = correlation;
  const maxAbsValue = Math.max(1e-9, ...values.map((v) => Math.abs(v)));
  return {
    points: lags.map((lag, i) => ({ x: lag, y: values[i]! })),
    viewport: { xMin: lags[0]!, xMax: lags[lags.length - 1]!, yMin: -maxAbsValue * 1.1, yMax: maxAbsValue * 1.1 },
  };
}

const WAVEFORM_WIDTH = 640;
const WAVEFORM_HEIGHT = 220;
const SPECTRUM_WIDTH = 640;
const SPECTRUM_HEIGHT = 220;
const SPECTROGRAM_WIDTH = 640;
const SPECTROGRAM_HEIGHT = 260;
const CORRELATION_WIDTH = 640;
const CORRELATION_HEIGHT = 200;

function seedSignalState(graph: CellGraph, ids: CellIdsSignal, state: SignalState): void {
  graph.set(ids.exprText, state.exprText);
  graph.set(ids.sampleRate, state.sampleRate);
  graph.set(ids.duration, state.duration);
  graph.set(ids.nperseg, state.nperseg);
  graph.set(ids.noverlap, state.noverlap);
  graph.set(ids.showPeaks, state.showPeaks ?? DEFAULT_SIGNAL_STATE.showPeaks);
  graph.set(ids.minAmplitude, state.minAmplitude ?? DEFAULT_SIGNAL_STATE.minAmplitude);
  graph.set(ids.minSpacingHz, state.minSpacingHz ?? DEFAULT_SIGNAL_STATE.minSpacingHz);
  graph.set(ids.minProminence, state.minProminence ?? DEFAULT_SIGNAL_STATE.minProminence);
  graph.set(ids.showCorrelation, state.showCorrelation ?? DEFAULT_SIGNAL_STATE.showCorrelation);
  graph.set(ids.exprTextB, state.exprTextB ?? DEFAULT_SIGNAL_STATE.exprTextB);
}

function getCurrentSignalState(graph: CellGraph, ids: CellIdsSignal): SignalState {
  return {
    v: 2,
    exprText: graph.get<string>(ids.exprText),
    sampleRate: graph.get<string>(ids.sampleRate),
    duration: graph.get<string>(ids.duration),
    nperseg: graph.get<string>(ids.nperseg),
    noverlap: graph.get<string>(ids.noverlap),
    showPeaks: graph.get<boolean>(ids.showPeaks),
    minAmplitude: graph.get<string>(ids.minAmplitude),
    minSpacingHz: graph.get<string>(ids.minSpacingHz),
    minProminence: graph.get<string>(ids.minProminence),
    showCorrelation: graph.get<boolean>(ids.showCorrelation),
    exprTextB: graph.get<string>(ids.exprTextB),
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

    graph.define(ids.peaksResult, (): Result<SpectrumPeak[]> => {
      const spectrum = graph.get<Result<AmplitudeSpectrum>>(ids.spectrumResult);
      if (!spectrum.ok) return spectrum;
      try {
        const minAmplitude = Number(graph.get<string>(ids.minAmplitude));
        const minSpacingHz = Number(graph.get<string>(ids.minSpacingHz));
        const minProminence = Number(graph.get<string>(ids.minProminence));
        if (Number.isNaN(minAmplitude) || Number.isNaN(minSpacingHz) || Number.isNaN(minProminence)) {
          throw new Error("Peak thresholds must all be numbers.");
        }
        return {
          ok: true,
          value: findSpectrumPeaks(spectrum.value, {
            minAmplitude: minAmplitude > 0 ? minAmplitude : undefined,
            minSpacingHz: minSpacingHz > 0 ? minSpacingHz : undefined,
            minProminence: minProminence > 0 ? minProminence : undefined,
          }),
        };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    graph.define(ids.spectrogramResult, (): Result<Spectrogram> => {
      const waveform = graph.get<Result<Waveform>>(ids.waveformResult);
      if (!waveform.ok) return waveform;
      try {
        const nperseg = Number(graph.get<string>(ids.nperseg));
        const noverlap = Number(graph.get<string>(ids.noverlap));
        if (Number.isNaN(nperseg) || Number.isNaN(noverlap)) throw new Error("nperseg and noverlap must both be numbers.");
        return { ok: true, value: computeSpectrogram(waveform.value, nperseg, noverlap) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    graph.define(ids.waveformBResult, (): Result<Waveform> => {
      try {
        const exprTextB = graph.get<string>(ids.exprTextB);
        const sampleRate = Number(graph.get<string>(ids.sampleRate));
        const duration = Number(graph.get<string>(ids.duration));
        if (Number.isNaN(sampleRate) || Number.isNaN(duration)) throw new Error("Sample rate and duration must both be numbers.");
        return { ok: true, value: sampleWaveform(exprTextB, sampleRate, duration) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    graph.define(ids.correlationResult, (): Result<CorrelationResult> => {
      const waveformA = graph.get<Result<Waveform>>(ids.waveformResult);
      if (!waveformA.ok) return waveformA;
      const waveformB = graph.get<Result<Waveform>>(ids.waveformBResult);
      if (!waveformB.ok) return waveformB;
      try {
        return { ok: true, value: crossCorrelate(waveformA.value, waveformB.value) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    ref.current = graph;
  }
  return ref.current;
}

/**
 * Signal panel (part of #31): compose f(t), see its waveform, its one-sided
 * amplitude spectrum via `mallory-fft`'s `rfft`, and its time-varying
 * spectrogram via `mallory-signal`'s windowed `stft` -- pipeline stage 3.
 * Filter design/Bode plot, PSD, cross-correlation, and Phase 2 live audio
 * are deferred (see the trimmed issue body).
 */
export function SignalPanel({ cellId = "signal-1" }: { cellId?: string } = {}) {
  const graph = useSignalGraph(cellId);
  useCellGraphTools(`signal_${cellId}`, graph);
  const ids = cellIdsSignal(cellId);
  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const spectrumCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const spectrogramCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const correlationCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const exprText = useCell<string>(graph, ids.exprText);
  const sampleRate = useCell<string>(graph, ids.sampleRate);
  const duration = useCell<string>(graph, ids.duration);
  const waveformResult = useCell<Result<Waveform>>(graph, ids.waveformResult);
  const spectrumResult = useCell<Result<AmplitudeSpectrum>>(graph, ids.spectrumResult);
  const nperseg = useCell<string>(graph, ids.nperseg);
  const noverlap = useCell<string>(graph, ids.noverlap);
  const spectrogramResult = useCell<Result<Spectrogram>>(graph, ids.spectrogramResult);
  const showPeaks = useCell<boolean>(graph, ids.showPeaks);
  const minAmplitude = useCell<string>(graph, ids.minAmplitude);
  const minSpacingHz = useCell<string>(graph, ids.minSpacingHz);
  const minProminence = useCell<string>(graph, ids.minProminence);
  const peaksResult = useCell<Result<SpectrumPeak[]>>(graph, ids.peaksResult);
  const showCorrelation = useCell<boolean>(graph, ids.showCorrelation);
  const exprTextB = useCell<string>(graph, ids.exprTextB);
  const correlationResult = useCell<Result<CorrelationResult>>(graph, ids.correlationResult);

  const [exprInput, setExprInput] = useState(exprText);
  const [exprInputB, setExprInputB] = useState(exprTextB);
  useEffect(() => {
    setExprInputB(exprTextB);
  }, [exprTextB]);

  function updateExprTextB(value: string) {
    setExprInputB(value);
    graph.set(ids.exprTextB, resolveNaturalLanguageQuery(value, "t") ?? value);
  }
  // Keeps the input box in sync when exprText changes for a reason other
  // than typing in this box -- e.g. URL-hash hydration -- mirrors
  // GraphCanvas/TaylorPanel's identically-reasoned effect.
  useEffect(() => {
    setExprInput(exprText);
  }, [exprText]);

  function updateExprText(value: string) {
    setExprInput(value);
    graph.set(ids.exprText, resolveNaturalLanguageQuery(value, "t") ?? value);
  }

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
    const { points, viewport } = waveformPlot(waveformResult.value);
    drawPolyline(ctx, points, viewport, WAVEFORM_WIDTH, WAVEFORM_HEIGHT);
  }, [waveformResult]);

  useEffect(() => {
    const canvas = spectrumCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, SPECTRUM_WIDTH, SPECTRUM_HEIGHT);
    if (!spectrumResult.ok) return;
    const { points, viewport } = spectrumPlot(spectrumResult.value);
    drawPolyline(ctx, points, viewport, SPECTRUM_WIDTH, SPECTRUM_HEIGHT, "#dc2626");
    if (showPeaks && peaksResult.ok) {
      for (const peak of peaksResult.value) {
        drawPoint(ctx, { x: peak.frequency, y: peak.amplitude }, viewport, SPECTRUM_WIDTH, SPECTRUM_HEIGHT, 5, "#16a34a");
      }
    }
  }, [spectrumResult, showPeaks, peaksResult]);

  useEffect(() => {
    const canvas = spectrogramCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, SPECTROGRAM_WIDTH, SPECTROGRAM_HEIGHT);
    if (!spectrogramResult.ok) return;
    drawSpectrogram(ctx, spectrogramResult.value, SPECTROGRAM_WIDTH, SPECTROGRAM_HEIGHT);
  }, [spectrogramResult]);

  useEffect(() => {
    const canvas = correlationCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, CORRELATION_WIDTH, CORRELATION_HEIGHT);
    if (!showCorrelation || !correlationResult.ok) return;
    const { points, viewport } = correlationPlot(correlationResult.value);
    drawPolyline(ctx, points, viewport, CORRELATION_WIDTH, CORRELATION_HEIGHT, "#7c3aed");
    drawPoint(
      ctx,
      { x: correlationResult.value.peakLagSeconds, y: correlationResult.value.peakValue },
      viewport,
      CORRELATION_WIDTH,
      CORRELATION_HEIGHT,
      5,
      "#16a34a",
    );
  }, [showCorrelation, correlationResult]);

  return (
    <div>
      <h2>Compose f(t)</h2>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <label>
          f(t) ={" "}
          <input value={exprInput} onChange={(e) => updateExprText(e.target.value)} style={{ font: "inherit", width: "28ch" }} />
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
      {!waveformResult.ok && <p style={{ color: "var(--danger)" }}>{waveformResult.message}</p>}
      {waveformResult.ok && (
        <p style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
          {waveformResult.value.y.length} samples ({(waveformResult.value.y.length / waveformResult.value.sampleRate).toFixed(3)}s -- rounded up to a
          power of two).
        </p>
      )}

      <h3>Waveform</h3>
      <canvas ref={waveformCanvasRef} width={WAVEFORM_WIDTH} height={WAVEFORM_HEIGHT} style={{ border: "1px solid var(--border)", maxWidth: "100%" }} />
      <div style={{ margin: "0.25rem 0" }}>
        <PngExportButton getCanvas={() => waveformCanvasRef.current} label="signal-waveform" />{" "}
        <SvgExportButton
          getSvg={() => {
            if (!waveformResult.ok) return null;
            const { points, viewport } = waveformPlot(waveformResult.value);
            return polylineToSvgDocument(points, viewport, WAVEFORM_WIDTH, WAVEFORM_HEIGHT);
          }}
          label="signal-waveform"
        />
      </div>

      <h3>Amplitude spectrum</h3>
      {!spectrumResult.ok && <p style={{ color: "var(--danger)" }}>{spectrumResult.message}</p>}
      <canvas ref={spectrumCanvasRef} width={SPECTRUM_WIDTH} height={SPECTRUM_HEIGHT} style={{ border: "1px solid var(--border)", maxWidth: "100%" }} />
      <div style={{ margin: "0.25rem 0" }}>
        <PngExportButton getCanvas={() => spectrumCanvasRef.current} label="signal-spectrum" />{" "}
        <SvgExportButton
          getSvg={() => {
            if (!spectrumResult.ok) return null;
            const { points, viewport } = spectrumPlot(spectrumResult.value);
            return polylineToSvgDocument(points, viewport, SPECTRUM_WIDTH, SPECTRUM_HEIGHT, "#dc2626");
          }}
          label="signal-spectrum"
        />
      </div>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <label>
          <input type="checkbox" checked={showPeaks} onChange={(e) => graph.set(ids.showPeaks, e.target.checked)} /> Find peaks
        </label>
        {showPeaks && (
          <>
            <label>
              min amplitude:{" "}
              <input
                type="number"
                min={0}
                step="any"
                value={minAmplitude}
                onChange={(e) => graph.set(ids.minAmplitude, e.target.value)}
                style={{ font: "inherit", width: "8ch" }}
              />
            </label>
            <label>
              min spacing (Hz):{" "}
              <input
                type="number"
                min={0}
                step="any"
                value={minSpacingHz}
                onChange={(e) => graph.set(ids.minSpacingHz, e.target.value)}
                style={{ font: "inherit", width: "8ch" }}
              />
            </label>
            <label>
              min prominence:{" "}
              <input
                type="number"
                min={0}
                step="any"
                value={minProminence}
                onChange={(e) => graph.set(ids.minProminence, e.target.value)}
                style={{ font: "inherit", width: "8ch" }}
              />
            </label>
          </>
        )}
      </div>
      {showPeaks && !peaksResult.ok && <p style={{ color: "var(--danger)" }}>{peaksResult.message}</p>}
      {showPeaks && peaksResult.ok && (
        <ul style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
          {peaksResult.value.length === 0 && <li>No peaks found.</li>}
          {peaksResult.value.map((peak) => (
            <li key={peak.frequency}>
              {peak.frequency.toFixed(2)}Hz -- amplitude {peak.amplitude.toFixed(3)}, prominence {peak.prominence.toFixed(3)}
            </li>
          ))}
        </ul>
      )}

      <h3>Spectrogram</h3>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <label>
          window size (nperseg):{" "}
          <input
            type="number"
            min={2}
            value={nperseg}
            onChange={(e) => graph.set(ids.nperseg, e.target.value)}
            style={{ font: "inherit", width: "6ch" }}
          />
        </label>
        <label>
          overlap (noverlap):{" "}
          <input
            type="number"
            min={0}
            value={noverlap}
            onChange={(e) => graph.set(ids.noverlap, e.target.value)}
            style={{ font: "inherit", width: "6ch" }}
          />
        </label>
      </div>
      {!spectrogramResult.ok && <p style={{ color: "var(--danger)" }}>{spectrogramResult.message}</p>}
      <canvas
        ref={spectrogramCanvasRef}
        width={SPECTROGRAM_WIDTH}
        height={SPECTROGRAM_HEIGHT}
        style={{ border: "1px solid var(--border)", maxWidth: "100%" }}
      />
      <div style={{ margin: "0.25rem 0" }}>
        <PngExportButton getCanvas={() => spectrogramCanvasRef.current} label="signal-spectrogram" />
      </div>

      <h3>Cross-correlation</h3>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <label>
          <input type="checkbox" checked={showCorrelation} onChange={(e) => graph.set(ids.showCorrelation, e.target.checked)} /> Find lag vs. a second
          signal
        </label>
        {showCorrelation && (
          <label>
            g(t) ={" "}
            <input value={exprInputB} onChange={(e) => updateExprTextB(e.target.value)} style={{ font: "inherit", width: "28ch" }} />
          </label>
        )}
      </div>
      {showCorrelation && (
        <>
          {!correlationResult.ok && <p style={{ color: "var(--danger)" }}>{correlationResult.message}</p>}
          {correlationResult.ok && (
            <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
              Best-fit lag: g(t) is {Math.abs(correlationResult.value.peakLagSeconds).toFixed(4)}s{" "}
              {correlationResult.value.peakLagSeconds >= 0 ? "behind" : "ahead of"} f(t).
            </p>
          )}
          <canvas
            ref={correlationCanvasRef}
            width={CORRELATION_WIDTH}
            height={CORRELATION_HEIGHT}
            style={{ border: "1px solid var(--border)", maxWidth: "100%" }}
          />
          <div style={{ margin: "0.25rem 0" }}>
            <PngExportButton getCanvas={() => correlationCanvasRef.current} label="signal-correlation" />{" "}
            <SvgExportButton
              getSvg={() => {
                if (!correlationResult.ok) return null;
                const { points, viewport } = correlationPlot(correlationResult.value);
                return polylineToSvgDocument(points, viewport, CORRELATION_WIDTH, CORRELATION_HEIGHT, "#7c3aed");
              }}
              label="signal-correlation"
            />
          </div>
        </>
      )}
    </div>
  );
}
