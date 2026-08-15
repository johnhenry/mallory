import { useEffect, useRef, useState } from "react";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsImageFrequency, type CellIdsImageFrequency } from "../lib/cell-ids.ts";
import {
  DEFAULT_IMAGE_FREQUENCY_STATE,
  decodeImageFrequencyState,
  encodeImageFrequencyState,
  type ImageFrequencyState,
} from "../lib/image-frequency-state.ts";
import {
  analyzeImageFrequency,
  drawGrayscaleGrid,
  generatePattern,
  type FrequencyResult,
  type MaskType,
  type PatternType,
} from "../lib/image-frequency.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useCell } from "../lib/use-cell.ts";
import { PngExportButton } from "./PngExportButton.tsx";

type Result<T> = { ok: true; value: T } | { ok: false; message: string };

const CANVAS_SIZE = 256;

const PATTERN_LABELS: Record<PatternType, string> = {
  checkerboard: "Checkerboard",
  stripes: "Stripes",
  circle: "Circle",
  gradient: "Gradient",
  moire: "Moire (two gratings)",
};

const MASK_LABELS: Record<MaskType, string> = {
  lowpass: "Low-pass (blur)",
  highpass: "High-pass (edges)",
  bandpass: "Band-pass (ring)",
  notch: "Notch (reject a ring)",
  wedge: "Directional wedge",
  none: "None (pass-through)",
};

function seedState(graph: CellGraph, ids: CellIdsImageFrequency, state: ImageFrequencyState): void {
  graph.set(ids.pattern, state.pattern);
  graph.set(ids.size, state.size);
  graph.set(ids.maskType, state.maskType);
  graph.set(ids.radius, state.radius);
  graph.set(ids.radius2, state.radius2);
  graph.set(ids.wedgeAngle, state.wedgeAngle ?? DEFAULT_IMAGE_FREQUENCY_STATE.wedgeAngle);
  graph.set(ids.wedgeWidth, state.wedgeWidth ?? DEFAULT_IMAGE_FREQUENCY_STATE.wedgeWidth);
}

function getCurrentState(graph: CellGraph, ids: CellIdsImageFrequency): ImageFrequencyState {
  return {
    v: 1,
    pattern: graph.get<PatternType>(ids.pattern),
    size: graph.get<string>(ids.size),
    maskType: graph.get<MaskType>(ids.maskType),
    radius: graph.get<string>(ids.radius),
    radius2: graph.get<string>(ids.radius2),
    wedgeAngle: graph.get<string>(ids.wedgeAngle),
    wedgeWidth: graph.get<string>(ids.wedgeWidth),
  };
}

function useImageFrequencyGraph(cellId: string): CellGraph {
  const ref = useRef<CellGraph | null>(null);
  if (!ref.current) {
    const graph = new CellGraph();
    const ids = cellIdsImageFrequency(cellId);
    const decoded = typeof window !== "undefined" ? decodeImageFrequencyState(window.location.hash.slice(1)) : null;
    seedState(graph, ids, decoded ?? DEFAULT_IMAGE_FREQUENCY_STATE);

    graph.define(ids.result, (): Result<FrequencyResult> => {
      try {
        const pattern = graph.get<PatternType>(ids.pattern);
        const size = Number(graph.get<string>(ids.size));
        const maskType = graph.get<MaskType>(ids.maskType);
        const radius = Number(graph.get<string>(ids.radius));
        const radius2 = Number(graph.get<string>(ids.radius2));
        const wedgeAngle = Number(graph.get<string>(ids.wedgeAngle));
        const wedgeWidth = Number(graph.get<string>(ids.wedgeWidth));
        if ([size, radius, radius2, wedgeAngle, wedgeWidth].some(Number.isNaN)) {
          throw new Error("Size, radii, and wedge angle/width must all be numbers.");
        }
        const source = generatePattern(pattern, size);
        return { ok: true, value: analyzeImageFrequency(source, size, maskType, radius, radius2, wedgeAngle, wedgeWidth) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    ref.current = graph;
  }
  return ref.current;
}

/**
 * 2D Fourier analysis of an image (issue #32): a built-in test pattern's
 * centered magnitude spectrum (`fft2` + `fftshift`), a parametric low-pass/
 * high-pass/band-pass mask, and the filtered result inverted back
 * (`ifftshift` + `ifft2`). Classic demos fall out directly: low-pass on the
 * checkerboard flattens it (blur), high-pass keeps only edges.
 *
 * File upload (drag-and-drop an arbitrary image) is deferred -- built-in
 * patterns are already grayscale and power-of-two-sized by construction,
 * sidestepping RGB-to-grayscale conversion and letting this PR focus on the
 * fft2/fftshift/mask/ifft2 pipeline itself, the CAS-correctness-heavy core.
 */
export function ImageFrequencyPanel({ cellId = "image-freq-1" }: { cellId?: string } = {}) {
  const graph = useImageFrequencyGraph(cellId);
  useCellGraphTools(`image_frequency_${cellId}`, graph);
  const ids = cellIdsImageFrequency(cellId);
  const originalCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const spectrumCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const filteredCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const pattern = useCell<PatternType>(graph, ids.pattern);
  const size = useCell<string>(graph, ids.size);
  const maskType = useCell<MaskType>(graph, ids.maskType);
  const radius = useCell<string>(graph, ids.radius);
  const radius2 = useCell<string>(graph, ids.radius2);
  const wedgeAngle = useCell<string>(graph, ids.wedgeAngle);
  const wedgeWidth = useCell<string>(graph, ids.wedgeWidth);
  const result = useCell<Result<FrequencyResult>>(graph, ids.result);

  useEffect(() => {
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeImageFrequencyState(getCurrentState(graph, ids))}`);
    }
    writeUrl();
    return graph.subscribeAll(writeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  useEffect(() => {
    const original = originalCanvasRef.current?.getContext("2d");
    const spectrum = spectrumCanvasRef.current?.getContext("2d");
    const filtered = filteredCanvasRef.current?.getContext("2d");
    if (!original || !spectrum || !filtered) return;
    original.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    spectrum.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    filtered.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    if (!result.ok) return;
    drawGrayscaleGrid(original, result.value.original, CANVAS_SIZE, CANVAS_SIZE);
    drawGrayscaleGrid(spectrum, result.value.magnitudeSpectrum, CANVAS_SIZE, CANVAS_SIZE);
    drawGrayscaleGrid(filtered, result.value.filtered, CANVAS_SIZE, CANVAS_SIZE);
  }, [result]);

  return (
    <div>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <label>
          pattern:{" "}
          <select value={pattern} onChange={(e) => graph.set(ids.pattern, e.target.value as PatternType)}>
            {(Object.keys(PATTERN_LABELS) as PatternType[]).map((p) => (
              <option key={p} value={p}>
                {PATTERN_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
        <label>
          size:{" "}
          <select value={size} onChange={(e) => graph.set(ids.size, e.target.value)}>
            <option value="32">32</option>
            <option value="64">64</option>
            <option value="128">128</option>
          </select>
        </label>
      </div>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <label>
          mask:{" "}
          <select value={maskType} onChange={(e) => graph.set(ids.maskType, e.target.value as MaskType)}>
            {(Object.keys(MASK_LABELS) as MaskType[]).map((m) => (
              <option key={m} value={m}>
                {MASK_LABELS[m]}
              </option>
            ))}
          </select>
        </label>
        <label>
          radius:{" "}
          <input
            type="number"
            min={0}
            value={radius}
            onChange={(e) => graph.set(ids.radius, e.target.value)}
            style={{ font: "inherit", width: "6ch" }}
          />
        </label>
        {(maskType === "bandpass" || maskType === "notch") && (
          <label>
            outer radius:{" "}
            <input
              type="number"
              min={0}
              value={radius2}
              onChange={(e) => graph.set(ids.radius2, e.target.value)}
              style={{ font: "inherit", width: "6ch" }}
            />
          </label>
        )}
        {maskType === "wedge" && (
          <>
            <label>
              angle (deg):{" "}
              <input
                type="number"
                value={wedgeAngle}
                onChange={(e) => graph.set(ids.wedgeAngle, e.target.value)}
                style={{ font: "inherit", width: "6ch" }}
              />
            </label>
            <label>
              width (deg):{" "}
              <input
                type="number"
                min={0}
                max={180}
                value={wedgeWidth}
                onChange={(e) => graph.set(ids.wedgeWidth, e.target.value)}
                style={{ font: "inherit", width: "6ch" }}
              />
            </label>
          </>
        )}
      </div>
      {!result.ok && <p style={{ color: "var(--danger)" }}>{result.message}</p>}
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <div>
          <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>Original</p>
          <canvas ref={originalCanvasRef} width={CANVAS_SIZE} height={CANVAS_SIZE} style={{ border: "1px solid var(--border)", maxWidth: "100%" }} />
          <div style={{ margin: "0.25rem 0" }}>
            <PngExportButton getCanvas={() => originalCanvasRef.current} label="image-frequency-original" />
          </div>
        </div>
        <div>
          <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>Magnitude spectrum (centered)</p>
          <canvas ref={spectrumCanvasRef} width={CANVAS_SIZE} height={CANVAS_SIZE} style={{ border: "1px solid var(--border)", maxWidth: "100%" }} />
          <div style={{ margin: "0.25rem 0" }}>
            <PngExportButton getCanvas={() => spectrumCanvasRef.current} label="image-frequency-spectrum" />
          </div>
        </div>
        <div>
          <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>Filtered</p>
          <canvas ref={filteredCanvasRef} width={CANVAS_SIZE} height={CANVAS_SIZE} style={{ border: "1px solid var(--border)", maxWidth: "100%" }} />
          <div style={{ margin: "0.25rem 0" }}>
            <PngExportButton getCanvas={() => filteredCanvasRef.current} label="image-frequency-filtered" />
          </div>
        </div>
      </div>
    </div>
  );
}
