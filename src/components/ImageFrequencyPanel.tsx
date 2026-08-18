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
  canvasPointToGridCell,
  drawGrayscaleGrid,
  generatePattern,
  makeAllOnesMask,
  paintMaskCell,
  rgbaToGrayscaleGrid,
  type FrequencyResult,
  type MaskType,
  type PatternType,
} from "../lib/image-frequency.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useLiveCameraFrame } from "../lib/live-input.ts";
import { useCell } from "../lib/use-cell.ts";
import { canvasEventPoint } from "../lib/viewport.ts";
import { PngExportButton } from "./PngExportButton.tsx";

const PAINT_BRUSH_RADIUS = 1;

type Result<T> = { ok: true; value: T } | { ok: false; message: string };

const CANVAS_SIZE = 256;

const PATTERN_LABELS: Record<PatternType, string> = {
  checkerboard: "Checkerboard",
  stripes: "Stripes",
  circle: "Circle",
  gradient: "Gradient",
  moire: "Moire (two gratings)",
  upload: "Upload an image",
  "live-camera": "Live camera",
};

const MASK_LABELS: Record<MaskType, string> = {
  lowpass: "Low-pass (blur)",
  highpass: "High-pass (edges)",
  bandpass: "Band-pass (ring)",
  notch: "Notch (reject a ring)",
  wedge: "Directional wedge",
  none: "None (pass-through)",
  freehand: "Freehand paint",
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
    // The uploaded grid can't live in the URL hash (arbitrary image size),
    // so it's a plain auxiliary cell -- excluded from getCurrentState/
    // seedState -- rather than part of the persisted schema, mirroring
    // GradientDescentPanel's surfaceMesh / MlPlaygroundPanel's
    // drawnPoints. Reselecting "Upload an image" after a reload shows the
    // upload prompt again rather than restoring the old image.
    if (!graph.has(ids.uploadedGrid)) graph.set(ids.uploadedGrid, null as number[][] | null, { auxiliary: true });
    // The painted mask is likewise auxiliary/non-URL-persisted (same
    // reasoning as uploadedGrid -- up to 128x128 numbers, no reasonable
    // hash-fragment size cap). Seeded all-1 (pass everything) at the
    // initial size, matching "freehand" starting as a no-op filter until
    // the user actually paints.
    if (!graph.has(ids.paintedMask)) {
      const initialSize = Number((decoded ?? DEFAULT_IMAGE_FREQUENCY_STATE).size);
      graph.set(ids.paintedMask, makeAllOnesMask(initialSize), { auxiliary: true });
    }

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
        let source: number[][];
        if (pattern === "upload" || pattern === "live-camera") {
          // Live-camera (issue #204's v1 pilot) reuses the SAME uploadedGrid
          // cell "upload" already reads -- structurally identical
          // consumption, just written by a RAF loop instead of a one-shot
          // FileReader (see useLiveCameraFrame in live-input.ts).
          const uploaded = graph.get<number[][] | null>(ids.uploadedGrid);
          if (!uploaded) throw new Error(pattern === "upload" ? "Choose an image file to upload first." : "Waiting for the first camera frame…");
          source = uploaded;
        } else {
          source = generatePattern(pattern, size);
        }
        const paintedMask = maskType === "freehand" ? graph.get<number[][]>(ids.paintedMask) : undefined;
        return { ok: true, value: analyzeImageFrequency(source, size, maskType, radius, radius2, wedgeAngle, wedgeWidth, paintedMask) };
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
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Live camera (issue #204's v1 pilot): feeds the SAME uploadedGrid cell
  // "upload" writes to (see the result define's own comment) -- only
  // active while pattern === "live-camera", so switching away stops the
  // stream via the hook's own enabled-flip cleanup.
  const liveCamera = useLiveCameraFrame(pattern === "live-camera", (data, width, height) => {
    graph.set(ids.uploadedGrid, rgbaToGrayscaleGrid(data, width, height));
  });
  // Which value a paint stroke sets cells to -- ephemeral UI state (like
  // MlPlaygroundPanel's drawLabel), not persisted.
  const [paintValue, setPaintValue] = useState<0 | 1>(0);
  const paintingRef = useRef(false);

  // Decodes an uploaded image entirely client-side (drawImage + getImageData
  // -- the first image-decode-into-canvas code in this codebase; no server
  // round-trip, mirroring DataImportPanel's client-only CSV read) into a
  // grayscale grid via rgbaToGrayscaleGrid, then feeds it into the same
  // uploadedGrid cell the result pipeline reads when pattern === "upload".
  function handleFile(file: File | undefined) {
    if (!file) return;
    setUploadError(null);
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setUploadError("Couldn't get a 2D canvas context to decode the image.");
        return;
      }
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      graph.set(ids.uploadedGrid, rgbaToGrayscaleGrid(imageData.data, canvas.width, canvas.height));
      graph.set(ids.pattern, "upload");
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setUploadError("Couldn't load that file as an image.");
    };
    img.src = url;
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    handleFile(e.dataTransfer.files[0]);
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
  }

  useEffect(() => {
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeImageFrequencyState(getCurrentState(graph, ids))}`);
    }
    writeUrl();
    return graph.subscribeAll(writeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  // A size change invalidates the painted mask's dimensions (analyzeImageFrequency
  // requires an exact size x size match), so it resets to a fresh all-1 mask
  // rather than erroring on the next freehand render.
  useEffect(() => {
    const n = Number(size);
    if (Number.isFinite(n) && n > 0) graph.set(ids.paintedMask, makeAllOnesMask(n));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

  // Click-and-drag painting on the spectrum canvas (issue #32's "freehand
  // mask painting" remaining scope item), only meaningful in freehand mode.
  function paintAt(e: { clientX: number; clientY: number }) {
    const canvas = spectrumCanvasRef.current;
    if (!canvas || maskType !== "freehand") return;
    const { sx, sy } = canvasEventPoint(e, canvas, CANVAS_SIZE, CANVAS_SIZE);
    const n = Number(size);
    if (!Number.isFinite(n) || n <= 0) return;
    const { gx, gy } = canvasPointToGridCell(sx, sy, CANVAS_SIZE, CANVAS_SIZE, n);
    const current = graph.get<number[][]>(ids.paintedMask);
    graph.set(ids.paintedMask, paintMaskCell(current, gx, gy, paintValue, PAINT_BRUSH_RADIUS));
  }

  function handlePaintDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (maskType !== "freehand") return;
    paintingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    paintAt(e);
  }

  function handlePaintMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!paintingRef.current) return;
    paintAt(e);
  }

  function handlePaintUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!paintingRef.current) return;
    paintingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  function handleClearMask() {
    const n = Number(size);
    if (Number.isFinite(n) && n > 0) graph.set(ids.paintedMask, makeAllOnesMask(n));
  }

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
      {pattern === "upload" && (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          style={{
            margin: "0.25rem 0",
            padding: "0.75rem",
            border: "2px dashed var(--border)",
            borderRadius: "4px",
            display: "flex",
            gap: "0.75rem",
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Drag an image here, or</span>
          <label style={{ fontSize: "0.9rem" }}>
            choose a file: <input type="file" accept="image/*" onChange={(e) => handleFile(e.target.files?.[0])} />
          </label>
        </div>
      )}
      {pattern === "live-camera" && (
        <div style={{ margin: "0.25rem 0", fontSize: "0.85rem" }}>
          <span style={{ color: liveCamera.active ? "var(--muted)" : "inherit" }}>{liveCamera.active ? "Camera live -- point it at something." : "Requesting camera access…"}</span>
          {liveCamera.error && <p style={{ color: "var(--danger)" }}>{liveCamera.error}</p>}
        </div>
      )}
      {uploadError && <p style={{ color: "var(--danger)" }}>{uploadError}</p>}
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
                min={0}
                max={360}
                value={wedgeAngle}
                onChange={(e) => graph.set(ids.wedgeAngle, e.target.value)}
                style={{ font: "inherit", width: "6ch" }}
              />
              <input
                type="range"
                aria-label="wedge angle slider"
                min={0}
                max={360}
                value={Number(wedgeAngle) || 0}
                onChange={(e) => graph.set(ids.wedgeAngle, e.target.value)}
                style={{ verticalAlign: "middle", marginLeft: "0.4rem" }}
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
              <input
                type="range"
                aria-label="wedge width slider"
                min={0}
                max={180}
                value={Number(wedgeWidth) || 0}
                onChange={(e) => graph.set(ids.wedgeWidth, e.target.value)}
                style={{ verticalAlign: "middle", marginLeft: "0.4rem" }}
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
          <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>
            Magnitude spectrum (centered){maskType === "freehand" ? " -- drag to paint" : ""}
          </p>
          <canvas
            ref={spectrumCanvasRef}
            width={CANVAS_SIZE}
            height={CANVAS_SIZE}
            onPointerDown={handlePaintDown}
            onPointerMove={handlePaintMove}
            onPointerUp={handlePaintUp}
            style={{
              border: "1px solid var(--border)",
              maxWidth: "100%",
              cursor: maskType === "freehand" ? "crosshair" : "default",
              touchAction: maskType === "freehand" ? "none" : "auto",
            }}
          />
          <div style={{ margin: "0.25rem 0" }}>
            <PngExportButton getCanvas={() => spectrumCanvasRef.current} label="image-frequency-spectrum" />
          </div>
          {maskType === "freehand" && (
            <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
              <label style={{ fontSize: "0.78rem" }}>
                <input type="radio" checked={paintValue === 0} onChange={() => setPaintValue(0)} /> reject (paint black)
              </label>
              <label style={{ fontSize: "0.78rem" }}>
                <input type="radio" checked={paintValue === 1} onChange={() => setPaintValue(1)} /> keep (paint white)
              </label>
              <button type="button" onClick={handleClearMask}>
                Clear mask (keep all)
              </button>
            </div>
          )}
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
