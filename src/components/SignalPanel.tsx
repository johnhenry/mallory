import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsSignal, type CellIdsSignal } from "../lib/cell-ids.ts";
import { DEFAULT_SIGNAL_STATE, decodeSignalState, encodeSignalState, type SignalState, type SinusoidTerm } from "../lib/signal-state.ts";
import { resolveNaturalLanguageQuery } from "../lib/nl-query.ts";
import { resolveFilterCommand } from "../lib/nl-query-filter.ts";
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
import { applyFilter, computeBodePlot, computeWelchPsd, designFilter, type BodePoint, type FilterType, type PsdPoint, type Sos } from "../lib/signal-filter.ts";
import { resampleWaveform } from "../lib/signal-resample.ts";
import { drawAxes, drawPoint, drawPolyline } from "../lib/render-path.ts";
import { polylineToSvgDocument } from "../lib/svg-export.ts";
import { PngExportButton } from "./PngExportButton.tsx";
import { SvgExportButton } from "./SvgExportButton.tsx";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useModelContextTool } from "../hooks/use-model-context-tool.ts";
import { useCell } from "../lib/use-cell.ts";
import type { Viewport } from "../lib/viewport.ts";

type Result<T> = { ok: true; value: T } | { ok: false; message: string };

interface PlotSeries {
  points: { x: number; y: number }[];
  viewport: Viewport;
}

/** A builder row with a React/cell key -- see RegressionRow's identical id-vs-state-shape split (SinusoidTerm, in signal-state.ts, carries no id). */
interface BuilderTerm extends SinusoidTerm {
  id: string;
}

/**
 * Builds a sum-of-sinusoids expression string ("A*sin(2*pi*f*t+p) + ...")
 * from builder rows (issue #31's "sum-of-sinusoids builder" alternative to
 * typing raw expression syntax). Verified empirically against the real
 * installed mallory-math package before wiring this up: `Symbolic.parse`
 * accepts this exact shape and `Symbolic.compile` evaluates it correctly
 * (hand-computed in the test file). A row with a blank amplitude/
 * frequency/phase is skipped rather than emitting invalid syntax -- same
 * "don't break the whole expression over one in-progress edit" reasoning
 * as every other panel's parse-error handling. An empty (or all-blank)
 * term list falls back to the literal "0" (parses fine as a flat
 * waveform) rather than an empty/invalid string.
 */
export function buildSumOfSinusoidsExpr(terms: readonly SinusoidTerm[]): string {
  const parts = terms
    .filter((t) => t.amplitude.trim() !== "" && t.frequency.trim() !== "" && t.phase.trim() !== "")
    .map((t) => `${t.amplitude}*sin(2*pi*${t.frequency}*t+${t.phase})`);
  return parts.length > 0 ? parts.join(" + ") : "0";
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

/** Shared by the Canvas2D draw effect and the SVG export getter, so the viewport math can't drift between the two. Magnitude only (dB) -- phase is rendered as a separate polyline sharing this same x-viewport. */
export function bodeMagnitudePlot(bode: readonly BodePoint[]): PlotSeries {
  const maxAbsDb = Math.max(1e-9, ...bode.map((p) => Math.abs(p.magnitudeDb)));
  return {
    points: bode.map((p) => ({ x: p.frequencyHz, y: p.magnitudeDb })),
    viewport: { xMin: 0, xMax: bode[bode.length - 1]!.frequencyHz, yMin: -maxAbsDb * 1.1, yMax: maxAbsDb * 1.1 },
  };
}

/** Shared by the Canvas2D draw effect and the SVG export getter, so the viewport math can't drift between the two. Phase, in degrees -- always in [-180,180] (no unwrapping, see computeBodePlot's own doc comment), so the viewport is fixed rather than data-fit. */
export function bodePhasePlot(bode: readonly BodePoint[]): PlotSeries {
  return {
    points: bode.map((p) => ({ x: p.frequencyHz, y: p.phaseDeg })),
    viewport: { xMin: 0, xMax: bode[bode.length - 1]!.frequencyHz, yMin: -180, yMax: 180 },
  };
}

/** Shared by the Canvas2D draw effect and the SVG export getter, so the viewport math can't drift between the two. */
export function psdPlot(psd: readonly PsdPoint[]): PlotSeries {
  const maxPower = Math.max(1e-9, ...psd.map((p) => p.power));
  return {
    points: psd.map((p) => ({ x: p.frequencyHz, y: p.power })),
    viewport: { xMin: 0, xMax: psd[psd.length - 1]!.frequencyHz, yMin: 0, yMax: maxPower * 1.1 },
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
const BODE_WIDTH = 640;
const BODE_HEIGHT = 200;
const PSD_WIDTH = 640;
const PSD_HEIGHT = 200;

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
  graph.set(ids.showResample, state.showResample ?? DEFAULT_SIGNAL_STATE.showResample);
  graph.set(ids.resampleUp, state.resampleUp ?? DEFAULT_SIGNAL_STATE.resampleUp);
  graph.set(ids.resampleDown, state.resampleDown ?? DEFAULT_SIGNAL_STATE.resampleDown);
  graph.set(ids.useBuilder, state.useBuilder ?? DEFAULT_SIGNAL_STATE.useBuilder);
  const builderTerms: BuilderTerm[] = (state.builderTerms ?? DEFAULT_SIGNAL_STATE.builderTerms ?? []).map((t) => ({
    id: crypto.randomUUID(),
    ...t,
  }));
  graph.set(ids.builderTerms, builderTerms);
  graph.set(ids.showFilter, state.showFilter ?? DEFAULT_SIGNAL_STATE.showFilter);
  graph.set(ids.filterType, state.filterType ?? DEFAULT_SIGNAL_STATE.filterType);
  graph.set(ids.filterOrder, state.filterOrder ?? DEFAULT_SIGNAL_STATE.filterOrder);
  graph.set(ids.filterCutoffHz, state.filterCutoffHz ?? DEFAULT_SIGNAL_STATE.filterCutoffHz);
  graph.set(ids.filterCutoffHzHigh, state.filterCutoffHzHigh ?? DEFAULT_SIGNAL_STATE.filterCutoffHzHigh);
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
    showResample: graph.get<boolean>(ids.showResample),
    resampleUp: graph.get<string>(ids.resampleUp),
    resampleDown: graph.get<string>(ids.resampleDown),
    useBuilder: graph.get<boolean>(ids.useBuilder),
    builderTerms: graph.get<BuilderTerm[]>(ids.builderTerms).map(({ amplitude, frequency, phase }) => ({ amplitude, frequency, phase })),
    showFilter: graph.get<boolean>(ids.showFilter),
    filterType: graph.get<string>(ids.filterType),
    filterOrder: graph.get<string>(ids.filterOrder),
    filterCutoffHz: graph.get<string>(ids.filterCutoffHz),
    filterCutoffHzHigh: graph.get<string>(ids.filterCutoffHzHigh),
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

    graph.define(ids.resampleResult, (): Result<Waveform> => {
      const waveform = graph.get<Result<Waveform>>(ids.waveformResult);
      if (!waveform.ok) return waveform;
      try {
        const up = Number(graph.get<string>(ids.resampleUp));
        const down = Number(graph.get<string>(ids.resampleDown));
        if (Number.isNaN(up) || Number.isNaN(down)) throw new Error("up and down must both be numbers.");
        return { ok: true, value: resampleWaveform(waveform.value, up, down) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    // Filter design (issue #31's remaining pipeline stages 4-5): a Sos
    // design cell, a filtered-waveform cell derived from it, a Bode-plot
    // cell derived from the design alone (no signal needed), and
    // before/after PSD cells for comparison.
    graph.define(ids.filterResult, (): Result<Sos> => {
      try {
        const waveform = graph.get<Result<Waveform>>(ids.waveformResult);
        if (!waveform.ok) throw new Error(waveform.message);
        const filterType = graph.get<string>(ids.filterType) as FilterType;
        const order = Number(graph.get<string>(ids.filterOrder));
        const cutoffHz = Number(graph.get<string>(ids.filterCutoffHz));
        if (Number.isNaN(order) || Number.isNaN(cutoffHz)) throw new Error("Filter order and cutoff must both be numbers.");
        if (filterType === "bandpass" || filterType === "bandstop") {
          const cutoffHzHigh = Number(graph.get<string>(ids.filterCutoffHzHigh));
          if (Number.isNaN(cutoffHzHigh)) throw new Error("The high cutoff must be a number.");
          return { ok: true, value: designFilter(order, [cutoffHz, cutoffHzHigh], waveform.value.sampleRate, filterType) };
        }
        return { ok: true, value: designFilter(order, cutoffHz, waveform.value.sampleRate, filterType) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    graph.define(ids.filteredWaveformResult, (): Result<Waveform> => {
      const sos = graph.get<Result<Sos>>(ids.filterResult);
      if (!sos.ok) return sos;
      const waveform = graph.get<Result<Waveform>>(ids.waveformResult);
      if (!waveform.ok) return waveform;
      try {
        return { ok: true, value: applyFilter(sos.value, waveform.value) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    graph.define(ids.bodeResult, (): Result<BodePoint[]> => {
      const sos = graph.get<Result<Sos>>(ids.filterResult);
      if (!sos.ok) return sos;
      const waveform = graph.get<Result<Waveform>>(ids.waveformResult);
      if (!waveform.ok) return waveform;
      try {
        return { ok: true, value: computeBodePlot(sos.value, waveform.value.sampleRate) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    graph.define(ids.psdBeforeResult, (): Result<PsdPoint[]> => {
      const waveform = graph.get<Result<Waveform>>(ids.waveformResult);
      if (!waveform.ok) return waveform;
      try {
        return { ok: true, value: computeWelchPsd(waveform.value) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    graph.define(ids.psdAfterResult, (): Result<PsdPoint[]> => {
      const filtered = graph.get<Result<Waveform>>(ids.filteredWaveformResult);
      if (!filtered.ok) return filtered;
      try {
        return { ok: true, value: computeWelchPsd(filtered.value) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    ref.current = graph;
  }
  return ref.current;
}

type SignalTab = "waveform" | "spectrum" | "spectrogram" | "filter" | "analyze";

const SIGNAL_TABS: readonly SignalTab[] = ["waveform", "spectrum", "spectrogram", "filter", "analyze"];

const SIGNAL_TAB_LABELS: Record<SignalTab, string> = {
  waveform: "Waveform",
  spectrum: "Spectrum",
  spectrogram: "Spectrogram",
  filter: "Filter",
  analyze: "Analyze",
};

/**
 * Signal panel (part of #31): compose f(t), see its waveform, its one-sided
 * amplitude spectrum via `mallory-fft`'s `rfft`, and its time-varying
 * spectrogram via `mallory-signal`'s windowed `stft` -- pipeline stage 3.
 * Filter design/Bode plot, PSD, cross-correlation, and Phase 2 live audio
 * are deferred (see the trimmed issue body).
 *
 * The pipeline-stage sections below (issue #31's remaining "CategoryTabs"
 * item) are grouped under a Waveform/Spectrum/Spectrogram/Filter/Analyze
 * tab row -- Analyze bundles cross-correlation and resample, the two
 * "extras" that don't have their own dedicated stage. Unlike
 * `CategoryTabs.tsx` (built to swap between otherwise-independent,
 * already-built panels), an inactive tab's section here is unmounted with a
 * plain conditional rather than that shared component: switching tabs
 * detaches a section's canvas ref, so `activeTab` is threaded into every
 * affected draw effect's own dependency array below to force a redraw when
 * a canvas remounts (a stale ref from before the unmount would otherwise
 * leave it blank until some unrelated cell next changed).
 */
export function SignalPanel({ cellId = "signal-1" }: { cellId?: string } = {}) {
  const graph = useSignalGraph(cellId);
  useCellGraphTools(`signal_${cellId}`, graph);
  const ids = cellIdsSignal(cellId);
  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const spectrumCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const spectrogramCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const correlationCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const resampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const filteredWaveformCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const bodeMagnitudeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const bodePhaseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const psdCanvasRef = useRef<HTMLCanvasElement | null>(null);

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
  const showResample = useCell<boolean>(graph, ids.showResample);
  const resampleUp = useCell<string>(graph, ids.resampleUp);
  const resampleDown = useCell<string>(graph, ids.resampleDown);
  const resampleResult = useCell<Result<Waveform>>(graph, ids.resampleResult);
  const useBuilder = useCell<boolean>(graph, ids.useBuilder);
  const builderTerms = useCell<BuilderTerm[]>(graph, ids.builderTerms);
  const showFilter = useCell<boolean>(graph, ids.showFilter);
  const filterType = useCell<string>(graph, ids.filterType);
  const filterOrder = useCell<string>(graph, ids.filterOrder);
  const filterCutoffHz = useCell<string>(graph, ids.filterCutoffHz);
  const filterCutoffHzHigh = useCell<string>(graph, ids.filterCutoffHzHigh);
  const filteredWaveformResult = useCell<Result<Waveform>>(graph, ids.filteredWaveformResult);
  const bodeResult = useCell<Result<BodePoint[]>>(graph, ids.bodeResult);
  const psdBeforeResult = useCell<Result<PsdPoint[]>>(graph, ids.psdBeforeResult);
  const psdAfterResult = useCell<Result<PsdPoint[]>>(graph, ids.psdAfterResult);

  const [activeTab, setActiveTab] = useState<SignalTab>("waveform");
  useModelContextTool({
    name: `signal_${cellId}_switch_tab`,
    description: `Switch the active tab on this signal panel. Available tabs: ${SIGNAL_TABS.map((t) => SIGNAL_TAB_LABELS[t]).join(", ")}.`,
    inputSchema: {
      type: "object",
      properties: {
        label: { type: "string", description: `One of: ${SIGNAL_TABS.map((t) => SIGNAL_TAB_LABELS[t]).join(", ")}` },
      },
      required: ["label"],
    },
    handler: (input: Record<string, unknown>) => {
      const label = String(input.label ?? "");
      const tab = SIGNAL_TABS.find((t) => SIGNAL_TAB_LABELS[t] === label);
      if (!tab) throw new Error(`Unknown tab "${label}". Available tabs: ${SIGNAL_TABS.map((t) => SIGNAL_TAB_LABELS[t]).join(", ")}.`);
      setActiveTab(tab);
      return { ok: true, label };
    },
  });

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

  // Filter-design commands (issue #31's remaining scope: 'NL query
  // patterns ("low-pass at 40 Hz")') are checked FIRST, before the
  // expression resolver -- "low-pass at 40 Hz" isn't a math expression at
  // all, so falling through to resolveNaturalLanguageQuery would just set
  // exprText to unparseable garbage. On a match, the filter-design fields
  // are set directly and exprText is left untouched; the input box reverts
  // to the current exprText (see nl-query-matrix.ts for the same "this
  // wasn't an expression" pattern, applied there to navigation instead).
  function updateExprText(value: string) {
    const filterCommand = resolveFilterCommand(value);
    if (filterCommand) {
      graph.set(ids.showFilter, true);
      graph.set(ids.filterType, filterCommand.filterType);
      graph.set(ids.filterCutoffHz, filterCommand.filterCutoffHz);
      if (filterCommand.filterType === "bandpass" || filterCommand.filterType === "bandstop") {
        graph.set(ids.filterCutoffHzHigh, filterCommand.filterCutoffHzHigh);
      }
      setExprInput(exprText);
      return;
    }
    setExprInput(value);
    graph.set(ids.exprText, resolveNaturalLanguageQuery(value, "t") ?? value);
  }

  // Sum-of-sinusoids builder (issue #31's remaining scope item): each row
  // edit both updates the row list AND regenerates exprText immediately --
  // unlike the plain-text path, there's no natural-language resolution
  // step, since the generated string is always well-formed.
  function updateTerm(termId: string, field: keyof SinusoidTerm, value: string) {
    const nextTerms = builderTerms.map((t) => (t.id === termId ? { ...t, [field]: value } : t));
    graph.set(ids.builderTerms, nextTerms);
    graph.set(ids.exprText, buildSumOfSinusoidsExpr(nextTerms));
  }

  function addTerm() {
    const nextTerms = [...builderTerms, { id: crypto.randomUUID(), amplitude: "1", frequency: "1", phase: "0" }];
    graph.set(ids.builderTerms, nextTerms);
    graph.set(ids.exprText, buildSumOfSinusoidsExpr(nextTerms));
  }

  function removeTerm(termId: string) {
    const nextTerms = builderTerms.filter((t) => t.id !== termId);
    graph.set(ids.builderTerms, nextTerms);
    graph.set(ids.exprText, buildSumOfSinusoidsExpr(nextTerms));
  }

  // Toggling ON regenerates exprText from the builder's own (independently
  // persisted) rows immediately, so the waveform reflects the table shown
  // rather than whatever the plain-text input last had.
  function toggleBuilder(next: boolean) {
    graph.set(ids.useBuilder, next);
    if (next) graph.set(ids.exprText, buildSumOfSinusoidsExpr(builderTerms));
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
    drawAxes(ctx, viewport, WAVEFORM_WIDTH, WAVEFORM_HEIGHT);
    drawPolyline(ctx, points, viewport, WAVEFORM_WIDTH, WAVEFORM_HEIGHT);
  }, [waveformResult, activeTab]);

  useEffect(() => {
    const canvas = spectrumCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, SPECTRUM_WIDTH, SPECTRUM_HEIGHT);
    if (!spectrumResult.ok) return;
    const { points, viewport } = spectrumPlot(spectrumResult.value);
    drawAxes(ctx, viewport, SPECTRUM_WIDTH, SPECTRUM_HEIGHT);
    drawPolyline(ctx, points, viewport, SPECTRUM_WIDTH, SPECTRUM_HEIGHT, "#dc2626");
    if (showPeaks && peaksResult.ok) {
      for (const peak of peaksResult.value) {
        drawPoint(ctx, { x: peak.frequency, y: peak.amplitude }, viewport, SPECTRUM_WIDTH, SPECTRUM_HEIGHT, 5, "#16a34a");
      }
    }
  }, [spectrumResult, showPeaks, peaksResult, activeTab]);

  useEffect(() => {
    const canvas = spectrogramCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, SPECTROGRAM_WIDTH, SPECTROGRAM_HEIGHT);
    if (!spectrogramResult.ok) return;
    drawSpectrogram(ctx, spectrogramResult.value, SPECTROGRAM_WIDTH, SPECTROGRAM_HEIGHT);
  }, [spectrogramResult, activeTab]);

  useEffect(() => {
    const canvas = correlationCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, CORRELATION_WIDTH, CORRELATION_HEIGHT);
    if (!showCorrelation || !correlationResult.ok) return;
    const { points, viewport } = correlationPlot(correlationResult.value);
    drawAxes(ctx, viewport, CORRELATION_WIDTH, CORRELATION_HEIGHT);
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
  }, [showCorrelation, correlationResult, activeTab]);

  useEffect(() => {
    const canvas = resampleCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, WAVEFORM_WIDTH, WAVEFORM_HEIGHT);
    if (!showResample || !resampleResult.ok) return;
    const { points, viewport } = waveformPlot(resampleResult.value);
    drawAxes(ctx, viewport, WAVEFORM_WIDTH, WAVEFORM_HEIGHT);
    drawPolyline(ctx, points, viewport, WAVEFORM_WIDTH, WAVEFORM_HEIGHT, "#0891b2");
  }, [showResample, resampleResult, activeTab]);

  useEffect(() => {
    const canvas = filteredWaveformCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, WAVEFORM_WIDTH, WAVEFORM_HEIGHT);
    if (!showFilter || !filteredWaveformResult.ok) return;
    const { points, viewport } = waveformPlot(filteredWaveformResult.value);
    drawAxes(ctx, viewport, WAVEFORM_WIDTH, WAVEFORM_HEIGHT);
    drawPolyline(ctx, points, viewport, WAVEFORM_WIDTH, WAVEFORM_HEIGHT, "#0d9488");
  }, [showFilter, filteredWaveformResult, activeTab]);

  useEffect(() => {
    const canvas = bodeMagnitudeCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, BODE_WIDTH, BODE_HEIGHT);
    if (!showFilter || !bodeResult.ok) return;
    const { points, viewport } = bodeMagnitudePlot(bodeResult.value);
    drawAxes(ctx, viewport, BODE_WIDTH, BODE_HEIGHT);
    drawPolyline(ctx, points, viewport, BODE_WIDTH, BODE_HEIGHT, "#4f46e5");
  }, [showFilter, bodeResult, activeTab]);

  useEffect(() => {
    const canvas = bodePhaseCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, BODE_WIDTH, BODE_HEIGHT);
    if (!showFilter || !bodeResult.ok) return;
    const { points, viewport } = bodePhasePlot(bodeResult.value);
    drawAxes(ctx, viewport, BODE_WIDTH, BODE_HEIGHT);
    drawPolyline(ctx, points, viewport, BODE_WIDTH, BODE_HEIGHT, "#c026d3");
  }, [showFilter, bodeResult, activeTab]);

  useEffect(() => {
    const canvas = psdCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, PSD_WIDTH, PSD_HEIGHT);
    if (!showFilter || !psdBeforeResult.ok || !psdAfterResult.ok) return;
    const before = psdBeforeResult.value;
    const after = psdAfterResult.value;
    const maxPower = Math.max(1e-9, ...before.map((p) => p.power), ...after.map((p) => p.power));
    const maxFreq = Math.max(before[before.length - 1]?.frequencyHz ?? 0, after[after.length - 1]?.frequencyHz ?? 0);
    const viewport: Viewport = { xMin: 0, xMax: maxFreq, yMin: 0, yMax: maxPower * 1.1 };
    drawAxes(ctx, viewport, PSD_WIDTH, PSD_HEIGHT);
    drawPolyline(
      ctx,
      before.map((p) => ({ x: p.frequencyHz, y: p.power })),
      viewport,
      PSD_WIDTH,
      PSD_HEIGHT,
      "#94a3b8",
    );
    drawPolyline(
      ctx,
      after.map((p) => ({ x: p.frequencyHz, y: p.power })),
      viewport,
      PSD_WIDTH,
      PSD_HEIGHT,
      "#0d9488",
    );
  }, [showFilter, psdBeforeResult, psdAfterResult, activeTab]);

  return (
    <div>
      <h2>Compose f(t)</h2>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        {!useBuilder && (
          <label>
            f(t) ={" "}
            <input value={exprInput} onChange={(e) => updateExprText(e.target.value)} style={{ font: "inherit", width: "28ch" }} />
          </label>
        )}
        <label style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
          <input type="checkbox" checked={useBuilder} onChange={(e) => toggleBuilder(e.target.checked)} /> sum-of-sinusoids builder
        </label>
      </div>
      {useBuilder && (
        <div style={{ margin: "0.25rem 0" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={headerCellStyle}>amplitude</th>
                  <th style={headerCellStyle}>frequency (Hz)</th>
                  <th style={headerCellStyle}>phase (rad)</th>
                  <th style={headerCellStyle} />
                </tr>
              </thead>
              <tbody>
                {builderTerms.map((term) => (
                  <tr key={term.id}>
                    <td style={dataCellStyle}>
                      <input
                        value={term.amplitude}
                        onChange={(e) => updateTerm(term.id, "amplitude", e.target.value)}
                        style={{ font: "inherit", width: "7ch" }}
                      />
                    </td>
                    <td style={dataCellStyle}>
                      <input
                        value={term.frequency}
                        onChange={(e) => updateTerm(term.id, "frequency", e.target.value)}
                        style={{ font: "inherit", width: "7ch" }}
                      />
                    </td>
                    <td style={dataCellStyle}>
                      <input
                        value={term.phase}
                        onChange={(e) => updateTerm(term.id, "phase", e.target.value)}
                        style={{ font: "inherit", width: "7ch" }}
                      />
                    </td>
                    <td style={dataCellStyle}>
                      <button
                        type="button"
                        onClick={() => removeTerm(term.id)}
                        disabled={builderTerms.length <= 1}
                        aria-label="Remove term"
                        title="Remove term"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" onClick={addTerm} style={{ margin: "0.5rem 0" }}>
            + Add term
          </button>
          <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>f(t) = {exprText}</p>
        </div>
      )}
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
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

      <div className="tab-row" role="tablist">
        {SIGNAL_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={tab === activeTab}
            className={tab === activeTab ? "tab-button active" : "tab-button"}
            onClick={() => setActiveTab(tab)}
          >
            {SIGNAL_TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {activeTab === "waveform" && (
        <>
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
        </>
      )}

      {activeTab === "spectrum" && (
        <>
          <h3>Amplitude spectrum</h3>
          {!spectrumResult.ok && <p style={{ color: "var(--danger)" }}>{spectrumResult.message}</p>}
          <canvas
            ref={spectrumCanvasRef}
            width={SPECTRUM_WIDTH}
            height={SPECTRUM_HEIGHT}
            style={{ border: "1px solid var(--border)", maxWidth: "100%" }}
          />
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
        </>
      )}

      {activeTab === "spectrogram" && (
        <>
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
        </>
      )}

      {activeTab === "analyze" && (
        <>
          <h3>Cross-correlation</h3>
          <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
            <label>
              <input type="checkbox" checked={showCorrelation} onChange={(e) => graph.set(ids.showCorrelation, e.target.checked)} /> Find lag vs. a
              second signal
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

          <h3>Resample</h3>
          <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
            <label>
              <input type="checkbox" checked={showResample} onChange={(e) => graph.set(ids.showResample, e.target.checked)} /> Resample the waveform
            </label>
            {showResample && (
              <>
                <label>
                  up:{" "}
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={resampleUp}
                    onChange={(e) => graph.set(ids.resampleUp, e.target.value)}
                    style={{ font: "inherit", width: "6ch" }}
                  />
                </label>
                <label>
                  down:{" "}
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={resampleDown}
                    onChange={(e) => graph.set(ids.resampleDown, e.target.value)}
                    style={{ font: "inherit", width: "6ch" }}
                  />
                </label>
              </>
            )}
          </div>
          {showResample && (
            <>
              {!resampleResult.ok && <p style={{ color: "var(--danger)" }}>{resampleResult.message}</p>}
              {resampleResult.ok && (
                <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
                  {resampleResult.value.y.length} samples at {resampleResult.value.sampleRate.toFixed(3)}Hz (was{" "}
                  {waveformResult.ok ? waveformResult.value.y.length : "?"} samples at {sampleRate}Hz).
                </p>
              )}
              <canvas
                ref={resampleCanvasRef}
                width={WAVEFORM_WIDTH}
                height={WAVEFORM_HEIGHT}
                style={{ border: "1px solid var(--border)", maxWidth: "100%" }}
              />
              <div style={{ margin: "0.25rem 0" }}>
                <PngExportButton getCanvas={() => resampleCanvasRef.current} label="signal-resample" />{" "}
                <SvgExportButton
                  getSvg={() => {
                    if (!resampleResult.ok) return null;
                    const { points, viewport } = waveformPlot(resampleResult.value);
                    return polylineToSvgDocument(points, viewport, WAVEFORM_WIDTH, WAVEFORM_HEIGHT, "#0891b2");
                  }}
                  label="signal-resample"
                />
              </div>
            </>
          )}
        </>
      )}

      {activeTab === "filter" && (
        <>
          <h3>Filter design</h3>
          <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
            <label>
              <input type="checkbox" checked={showFilter} onChange={(e) => graph.set(ids.showFilter, e.target.checked)} /> Design a Butterworth filter
            </label>
            {showFilter && (
              <>
                <label>
                  type:{" "}
                  <select value={filterType} onChange={(e) => graph.set(ids.filterType, e.target.value)}>
                    <option value="lowpass">lowpass</option>
                    <option value="highpass">highpass</option>
                    <option value="bandpass">bandpass</option>
                    <option value="bandstop">bandstop</option>
                  </select>
                </label>
                <label>
                  order:{" "}
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={filterOrder}
                    onChange={(e) => graph.set(ids.filterOrder, e.target.value)}
                    style={{ font: "inherit", width: "6ch" }}
                  />
                </label>
                <label>
                  {filterType === "bandpass" || filterType === "bandstop" ? "cutoff low (Hz):" : "cutoff (Hz):"}{" "}
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={filterCutoffHz}
                    onChange={(e) => graph.set(ids.filterCutoffHz, e.target.value)}
                    style={{ font: "inherit", width: "8ch" }}
                  />
                </label>
                {(filterType === "bandpass" || filterType === "bandstop") && (
                  <label>
                    cutoff high (Hz):{" "}
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={filterCutoffHzHigh}
                      onChange={(e) => graph.set(ids.filterCutoffHzHigh, e.target.value)}
                      style={{ font: "inherit", width: "8ch" }}
                    />
                  </label>
                )}
              </>
            )}
          </div>
          {showFilter && (
            <>
              {!bodeResult.ok && <p style={{ color: "var(--danger)" }}>{bodeResult.message}</p>}

              <p style={{ fontSize: "0.85rem", margin: "0.25rem 0" }}>Bode plot -- magnitude (dB)</p>
              <canvas
                ref={bodeMagnitudeCanvasRef}
                width={BODE_WIDTH}
                height={BODE_HEIGHT}
                style={{ border: "1px solid var(--border)", maxWidth: "100%" }}
              />
              <div style={{ margin: "0.25rem 0" }}>
                <PngExportButton getCanvas={() => bodeMagnitudeCanvasRef.current} label="signal-bode-magnitude" />{" "}
                <SvgExportButton
                  getSvg={() => {
                    if (!bodeResult.ok) return null;
                    const { points, viewport } = bodeMagnitudePlot(bodeResult.value);
                    return polylineToSvgDocument(points, viewport, BODE_WIDTH, BODE_HEIGHT, "#4f46e5");
                  }}
                  label="signal-bode-magnitude"
                />
              </div>

              <p style={{ fontSize: "0.85rem", margin: "0.25rem 0" }}>Bode plot -- phase (deg)</p>
              <canvas ref={bodePhaseCanvasRef} width={BODE_WIDTH} height={BODE_HEIGHT} style={{ border: "1px solid var(--border)", maxWidth: "100%" }} />
              <div style={{ margin: "0.25rem 0" }}>
                <PngExportButton getCanvas={() => bodePhaseCanvasRef.current} label="signal-bode-phase" />{" "}
                <SvgExportButton
                  getSvg={() => {
                    if (!bodeResult.ok) return null;
                    const { points, viewport } = bodePhasePlot(bodeResult.value);
                    return polylineToSvgDocument(points, viewport, BODE_WIDTH, BODE_HEIGHT, "#c026d3");
                  }}
                  label="signal-bode-phase"
                />
              </div>

              <p style={{ fontSize: "0.85rem", margin: "0.25rem 0" }}>Filtered waveform</p>
              {!filteredWaveformResult.ok && <p style={{ color: "var(--danger)" }}>{filteredWaveformResult.message}</p>}
              <canvas
                ref={filteredWaveformCanvasRef}
                width={WAVEFORM_WIDTH}
                height={WAVEFORM_HEIGHT}
                style={{ border: "1px solid var(--border)", maxWidth: "100%" }}
              />
              <div style={{ margin: "0.25rem 0" }}>
                <PngExportButton getCanvas={() => filteredWaveformCanvasRef.current} label="signal-filtered" />{" "}
                <SvgExportButton
                  getSvg={() => {
                    if (!filteredWaveformResult.ok) return null;
                    const { points, viewport } = waveformPlot(filteredWaveformResult.value);
                    return polylineToSvgDocument(points, viewport, WAVEFORM_WIDTH, WAVEFORM_HEIGHT, "#0d9488");
                  }}
                  label="signal-filtered"
                />
              </div>

              <p style={{ fontSize: "0.85rem", margin: "0.25rem 0" }}>
                PSD before (<span style={{ color: "#94a3b8" }}>gray</span>) vs. after (<span style={{ color: "#0d9488" }}>teal</span>) -- Welch's
                method, one-sided view (mallory-signal's <code>welch()</code> is disclosed two-sided/non-doubled; see signal-filter.ts's doc comment)
              </p>
              {!psdBeforeResult.ok && <p style={{ color: "var(--danger)" }}>{psdBeforeResult.message}</p>}
              {!psdAfterResult.ok && <p style={{ color: "var(--danger)" }}>{psdAfterResult.message}</p>}
              <canvas ref={psdCanvasRef} width={PSD_WIDTH} height={PSD_HEIGHT} style={{ border: "1px solid var(--border)", maxWidth: "100%" }} />
              <div style={{ margin: "0.25rem 0" }}>
                <PngExportButton getCanvas={() => psdCanvasRef.current} label="signal-psd" />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

const headerCellStyle: CSSProperties = { textAlign: "left", padding: "0.15rem 0.6rem", borderBottom: "1px solid var(--border)", fontWeight: 600 };
const dataCellStyle: CSSProperties = { padding: "0.15rem 0.6rem" };
