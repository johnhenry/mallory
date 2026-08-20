import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
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
import { getThemeColors } from "../lib/theme-colors.ts";
import { polylineToSvgDocument } from "../lib/svg-export.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useNonPassiveWheel } from "../hooks/use-non-passive-wheel.ts";
import { useCell } from "../lib/use-cell.ts";
import { canvasEventPoint, toDataX, toDataY } from "../lib/viewport.ts";
import { pinchZoomFactor, viewportFromAnchor, wheelZoomFactor } from "../lib/viewport-gestures.ts";
import { PngExportButton } from "./PngExportButton.tsx";
import { SvgExportButton } from "./SvgExportButton.tsx";

const WIDTH = 600;
const HEIGHT = 300;
const SAMPLE_COUNT = 400;
const X_RANGE = 2 * Math.PI;
const INITIAL_VIEWPORT: Viewport = { xMin: -X_RANGE, xMax: X_RANGE, yMin: -1.4, yMax: 1.4 };
const ZOOM_STEP = 1.1;
const ZOOM_COMMIT_DEBOUNCE_MS = 150;

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
    graph.set(ids.viewport, INITIAL_VIEWPORT, { auxiliary: true });
    graph.set<Viewport | null>(ids.liveViewport, null, { auxiliary: true });

    graph.define(ids.samples, (): SamplesResult => {
      try {
        const waveType = graph.get<FourierWaveType>(ids.waveType);
        const harmonicsText = graph.get<string>(ids.harmonics);
        const harmonics = Number(harmonicsText);
        if (!Number.isFinite(harmonics) || !Number.isInteger(harmonics)) throw new Error("Harmonics must be a whole number.");
        if (harmonics < 0) throw new Error("Harmonics must be zero or a positive integer.");
        if (harmonics > 500) throw new Error("Harmonics is capped at 500 -- higher counts don't change the picture, just the compute cost.");
        // Reads the COMMITTED viewport (ids.viewport), not a live mid-gesture
        // override (ids.liveViewport) -- panning/pinching only resamples
        // once, on gesture release, matching GraphCanvas's #184 convention.
        const vp = graph.get<Viewport>(ids.viewport);
        return { ok: true, value: sampleFourierPartialSum(waveType, harmonics, vp.xMin, vp.xMax, SAMPLE_COUNT) };
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
/**
 * Pure re-render of the target-wave/partial-sum canvas, extracted from the
 * draw effect below so `PngExportButton`'s `renderAtScale` (issue #278)
 * can call it against a fresh offscreen canvas at any size.
 */
export function drawFourierPanel(ctx: CanvasRenderingContext2D, width: number, height: number, viewport: Viewport, samples: SamplesResult): void {
  ctx.clearRect(0, 0, width, height);
  drawAxes(ctx, viewport, width, height);
  if (!samples.ok) return;
  // Partial sum FIRST, dashed true-wave reference LAST (issue #315): the
  // dashed layer used to draw underneath the solid blue partial sum, so
  // wherever the series approximates well -- the flat segments, exactly
  // where a reader looks for the reference -- it was completely hidden and
  // the caption's "true wave (dashed)" appeared to be a lie.
  drawPolyline(ctx, samples.value.partial, viewport, width, height, "#2563eb");
  ctx.save();
  // getThemeColors(), not "var(--muted)" -- canvas strokeStyle does NOT
  // resolve CSS custom properties (theme-colors.ts's own doc comment); the
  // invalid assignment was silently ignored, leaving the dash in whatever
  // color the context last used. Second half of issue #315's invisibility.
  ctx.strokeStyle = getThemeColors().muted;
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  samples.value.target.forEach((p, i) => {
    // The target wave jumps discontinuously -- a straight connecting line
    // across a jump would draw a fake vertical edge that isn't part of
    // the actual step function, so a large y-gap between adjacent samples
    // starts a new subpath instead of a lineTo.
    const prev = samples.value.target[i - 1];
    const sx = ((p.x - viewport.xMin) / (viewport.xMax - viewport.xMin)) * width;
    const sy = height - ((p.y - viewport.yMin) / (viewport.yMax - viewport.yMin)) * height;
    if (i === 0 || (prev && Math.abs(p.y - prev.y) > 0.5)) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  });
  ctx.stroke();
  ctx.restore();
}

export function FourierPanel({ cellId = "fourier-1" }: { cellId?: string } = {}) {
  const graph = useFourierGraph(cellId);
  useCellGraphTools(`calculus_fourier_${cellId}`, graph);
  const ids = cellIdsFourier(cellId);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const waveType = useCell<FourierWaveType>(graph, ids.waveType);
  const harmonics = useCell<string>(graph, ids.harmonics);
  const samples = useCell<SamplesResult>(graph, ids.samples);
  const committedViewport = useCell<Viewport>(graph, ids.viewport);
  const liveViewport = useCell<Viewport | null>(graph, ids.liveViewport);
  const viewport = liveViewport ?? committedViewport;

  // Pan/pinch gesture state (issue #53), mirroring GraphCanvas/ParametricPanel.
  // No draggable handle on this canvas, so every pointerdown is a pinch
  // (2+ pointers) or a pan.
  const gestureRef = useRef<
    | { kind: "pan"; anchorX: number; anchorY: number; spanX: number; spanY: number }
    | { kind: "pinch"; anchorX: number; anchorY: number; spanX: number; spanY: number; startDistancePx: number }
    | null
  >(null);
  const activePointersRef = useRef<Map<number, { sx: number; sy: number }>>(new Map());
  const zoomCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [harmonicsInput, setHarmonicsInput] = useState(harmonics);
  useEffect(() => {
    setHarmonicsInput(harmonics);
  }, [harmonics]);

  // subscribeMany (not subscribeAll, issue #242 -- follow-up to #235) --
  // getCurrentFourierState only reads waveType/harmonics -- a small, fixed
  // cell list, same shape as ComplexPanel's own #235 fix -- so a
  // subscribeAll here used to re-run writeUrl on every pan/pinch/wheel-zoom
  // gesture tick (ids.liveViewport), even though the URL never encodes live
  // viewport state at all.
  useEffect(() => {
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeFourierState(getCurrentFourierState(graph, ids))}`);
    }
    writeUrl();
    return graph.subscribeMany([ids.waveType, ids.harmonics], writeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  useEffect(() => {
    return () => {
      if (zoomCommitTimerRef.current) clearTimeout(zoomCommitTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawFourierPanel(ctx, WIDTH, HEIGHT, viewport, samples);
  }, [samples, viewport]);

  /** Copies a pending live-viewport override into the committed viewport (the gesture-end resample) -- shared by pan/pinch release and the wheel-zoom debounce below. */
  function commitLiveViewport() {
    const live = graph.get<Viewport | null>(ids.liveViewport);
    if (!live) return;
    graph.set(ids.viewport, live);
    graph.set<Viewport | null>(ids.liveViewport, null);
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (zoomCommitTimerRef.current) {
      clearTimeout(zoomCommitTimerRef.current);
      zoomCommitTimerRef.current = null;
    }
    commitLiveViewport();

    const downPoint = canvasEventPoint(e, e.currentTarget, WIDTH, HEIGHT);
    activePointersRef.current.set(e.pointerId, downPoint);

    if (activePointersRef.current.size >= 2) {
      const [p1, p2] = [...activePointersRef.current.values()].slice(-2) as [{ sx: number; sy: number }, { sx: number; sy: number }];
      const midSx = (p1.sx + p2.sx) / 2;
      const midSy = (p1.sy + p2.sy) / 2;
      const vp = graph.get<Viewport | null>(ids.liveViewport) ?? graph.get<Viewport>(ids.viewport);
      gestureRef.current = {
        kind: "pinch",
        anchorX: toDataX(midSx, vp, WIDTH),
        anchorY: toDataY(midSy, vp, HEIGHT),
        spanX: vp.xMax - vp.xMin,
        spanY: vp.yMax - vp.yMin,
        startDistancePx: Math.hypot(p1.sx - p2.sx, p1.sy - p2.sy),
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    const vp = graph.get<Viewport>(ids.viewport);
    const { sx, sy } = downPoint;
    gestureRef.current = {
      kind: "pan",
      anchorX: toDataX(sx, vp, WIDTH),
      anchorY: toDataY(sy, vp, HEIGHT),
      spanX: vp.xMax - vp.xMin,
      spanY: vp.yMax - vp.yMin,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (activePointersRef.current.has(e.pointerId)) {
      activePointersRef.current.set(e.pointerId, canvasEventPoint(e, e.currentTarget, WIDTH, HEIGHT));
    }
    const gesture = gestureRef.current;
    if (!gesture) return;
    if (gesture.kind === "pinch") {
      const points = [...activePointersRef.current.values()].slice(-2);
      if (points.length < 2) return;
      const [p1, p2] = points as [{ sx: number; sy: number }, { sx: number; sy: number }];
      const currentDistancePx = Math.hypot(p1.sx - p2.sx, p1.sy - p2.sy);
      if (currentDistancePx < 1) return;
      const factor = pinchZoomFactor(gesture.startDistancePx, currentDistancePx);
      const spanX = gesture.spanX * factor;
      const spanY = gesture.spanY * factor;
      const midSx = (p1.sx + p2.sx) / 2;
      const midSy = (p1.sy + p2.sy) / 2;
      graph.set(ids.liveViewport, viewportFromAnchor(gesture.anchorX, gesture.anchorY, midSx, midSy, spanX, spanY, WIDTH, HEIGHT));
      return;
    }
    const { sx, sy } = canvasEventPoint(e, e.currentTarget, WIDTH, HEIGHT);
    graph.set(ids.liveViewport, viewportFromAnchor(gesture.anchorX, gesture.anchorY, sx, sy, gesture.spanX, gesture.spanY, WIDTH, HEIGHT));
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLCanvasElement>) {
    activePointersRef.current.delete(e.pointerId);
    if (gestureRef.current?.kind === "pan" || gestureRef.current?.kind === "pinch") commitLiveViewport();
    gestureRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  /**
   * Wheel-to-zoom, anchored on the cursor's data point; the real commit is
   * debounced (no pointerup to trigger it). Attached via `useNonPassiveWheel`
   * below, NOT the React `onWheel` prop -- see that hook's own doc comment
   * for why `preventDefault()` here only actually stops the page from also
   * scrolling when the listener itself is non-passive.
   */
  function handleWheel(e: WheelEvent) {
    if (!canvasRef.current) return;
    e.preventDefault();
    const vp = graph.get<Viewport | null>(ids.liveViewport) ?? graph.get<Viewport>(ids.viewport);
    const { sx, sy } = canvasEventPoint(e, canvasRef.current, WIDTH, HEIGHT);
    const anchorX = toDataX(sx, vp, WIDTH);
    const anchorY = toDataY(sy, vp, HEIGHT);
    const factor = wheelZoomFactor(e.deltaY, ZOOM_STEP);
    const spanX = (vp.xMax - vp.xMin) * factor;
    const spanY = (vp.yMax - vp.yMin) * factor;
    graph.set(ids.liveViewport, viewportFromAnchor(anchorX, anchorY, sx, sy, spanX, spanY, WIDTH, HEIGHT));
    if (zoomCommitTimerRef.current) clearTimeout(zoomCommitTimerRef.current);
    zoomCommitTimerRef.current = setTimeout(() => {
      zoomCommitTimerRef.current = null;
      commitLiveViewport();
    }, ZOOM_COMMIT_DEBOUNCE_MS);
  }
  useNonPassiveWheel(canvasRef, handleWheel);

  function resetView() {
    if (zoomCommitTimerRef.current) {
      clearTimeout(zoomCommitTimerRef.current);
      zoomCommitTimerRef.current = null;
    }
    graph.set<Viewport | null>(ids.liveViewport, null);
    graph.set(ids.viewport, INITIAL_VIEWPORT);
  }

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
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        style={{ border: "1px solid var(--border)", touchAction: "none" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
      <div style={{ margin: "0.25rem 0" }}>
        <PngExportButton
          getCanvas={() => canvasRef.current}
          label="fourier"
          renderAtScale={(ctx, width, height) => drawFourierPanel(ctx, width, height, viewport, samples)}
          baseWidth={WIDTH}
          baseHeight={HEIGHT}
        />
        <SvgExportButton getSvg={() => (samples.ok ? polylineToSvgDocument(samples.value.partial, viewport, WIDTH, HEIGHT, "#2563eb") : null)} label="fourier" />{" "}
        <button type="button" onClick={resetView}>
          Reset view
        </button>
      </div>
      {!samples.ok && <p style={{ color: "var(--danger)" }}>{samples.message}</p>}
    </div>
  );
}
