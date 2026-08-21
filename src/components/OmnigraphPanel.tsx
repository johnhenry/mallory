/**
 * Omnigraph: the unified graphing surface (/omnigraph) -- every graph type
 * from the Graphing and 3D & Surfaces tabs on ONE surface, with a single
 * "Add item" button and a per-row TYPE dropdown, instead of one panel per
 * type. Purely additive: the per-type panels stay untouched; this panel
 * composes their own shared library code (samplers, render-path, viewport
 * gestures, multi-panel-rows) rather than duplicating any of it.
 *
 * Phase 1 (this file's current scope): the 2D surface -- expression,
 * parametric, polar, implicit, and complex-domain-coloring items on one
 * pannable/zoomable canvas. The complex type renders as a BACKGROUND
 * RASTER layer (layered in list order, under the axes) -- the honest
 * degraded form of the Complex plane panel's per-function raster, whose
 * own doc comment explains why domain coloring can't overlay as a curve.
 * Phases 2-3 (3D upgrade + exotic types) extend this same panel; the
 * state codec (omnigraph-state.ts) already understands all 11 item types.
 *
 * Panel structure mirrors ParametricPanel (the cleanest multi-row +
 * pan/zoom precedent) with GraphCanvasMulti's URL-sync/hash-hydration
 * shape layered on.
 */
import type { Path2D } from "mallory-math";
import { ComplexNumber, Symbolic } from "mallory-math";
import { type PointerEvent as ReactPointerEvent, useEffect, useRef } from "react";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useModelContextTool } from "../hooks/use-model-context-tool.ts";
import { useNonPassiveWheel } from "../hooks/use-non-passive-wheel.ts";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsOmnigraph, cellIdsOmnigraphRow, type CellIdsOmnigraph } from "../lib/cell-ids.ts";
import { evaluateComplex, type ComplexEnv } from "../lib/complex-eval.ts";
import { renderDomainColoring } from "../lib/complex-raster.ts";
import { equationToImplicitZero } from "../lib/equation-to-zero.ts";
import { preprocessImplicitMultiplication } from "../lib/implicit-mult.ts";
import { appendRow, paletteColor, removeRow } from "../lib/multi-panel-rows.ts";
import { OMNIGRAPH_ITEM_TYPES, defaultOmnigraphItem, readOmnigraphItem, seedOmnigraphRow } from "../lib/omnigraph-items.ts";
import {
  DEFAULT_OMNIGRAPH_STATE,
  DEFAULT_OMNIGRAPH_VIEWPORT,
  decodeOmnigraphState,
  encodeOmnigraphState,
  type OmnigraphItem,
  type OmnigraphItemType,
  type OmnigraphState,
} from "../lib/omnigraph-state.ts";
import { drawAxes, drawImplicitCurve, drawPath, type Viewport } from "../lib/render-path.ts";
import { sampleExprAdaptive } from "../lib/sample-function.ts";
import { sampleImplicitCurve, type ImplicitSegment } from "../lib/sample-implicit.ts";
import { sampleParametricCurve, samplePolarCurve } from "../lib/sample-parametric.ts";
import { useCell } from "../lib/use-cell.ts";
import { canvasEventPoint, toDataX, toDataY } from "../lib/viewport.ts";
import { pinchZoomFactor, viewportFromAnchor, wheelZoomFactor } from "../lib/viewport-gestures.ts";
import { PngExportButton } from "./PngExportButton.tsx";

const WIDTH = 600;
const HEIGHT = 600;
const CURVE_RESOLUTION = 400;
const IMPLICIT_RESOLUTION = 80;
const ZOOM_STEP = 1.1;
const ZOOM_COMMIT_DEBOUNCE_MS = 150;
// Same reasoning (and value) as ComplexPanel's own constant: the domain-
// coloring raster is ~360K evaluations at this panel's canvas size, far too
// expensive per pointermove tick -- mid-gesture frames render the raster at
// 1/4 resolution and stretch it up, replaced by one full render on commit.
const LIVE_PREVIEW_DOWNSCALE = 4;

type Result<T> = { ok: true; value: T } | { ok: false; message: string };

/** The item types the dropdown offers TODAY -- grows to phase 2's 3D types and phase 3's exotic ones as those land; the state codec already understands all 11 (see omnigraph-state.ts's own doc comment). */
const AVAILABLE_TYPES = (Object.keys(OMNIGRAPH_ITEM_TYPES) as OmnigraphItemType[]).filter((t) => OMNIGRAPH_ITEM_TYPES[t].phase === 1);

/**
 * One item's drawable form, derived per row by the `graph.define`d cell
 * below (so it recomputes reactively, and errors surface per row instead
 * of killing the whole redraw). The complex variant carries the compiled
 * evaluator, not pixels -- rasterization happens at draw time because it
 * depends on the viewport, which pans/zooms without touching the row.
 */
type Drawable =
  | { kind: "path"; path: Path2D }
  | { kind: "segments"; segments: ImplicitSegment[]; expr: string }
  | { kind: "raster"; f: (z: ComplexNumber) => ComplexNumber };

/** Numeric parse of a user-editable bound string; throws the row-friendly message every source panel uses. */
function bound(text: string, label: string): number {
  const n = Number(text);
  if (!Number.isFinite(n)) throw new Error(`${label} must be a number.`);
  return n;
}

/**
 * Registers a row's derived `drawable` under its ERROR cell id -- the wide
 * row bag has no dedicated cell for it, and reusing `error` for a
 * Result<Drawable> keeps "one derived value per row" without widening the
 * bag (the row editor shows `!ok` messages from the same cell the draw
 * loop reads, so they can never disagree). Defined once per row seed and
 * re-defined on type switch -- `graph.define` over an existing define just
 * replaces the compute, matching CellGraph's own redefine semantics.
 *
 * The implicit variant deliberately reads the COMMITTED viewport cell (not
 * liveViewport): marching squares resamples on gesture commit, and
 * mid-gesture frames draw the cached segments under the live transform --
 * the plan's answer to ImplicitPanel having no pan/zoom at all.
 */
function defineRowDrawable(graph: CellGraph, rowId: string, containerIds: CellIdsOmnigraph): void {
  const ids = cellIdsOmnigraphRow(rowId);
  graph.define(ids.error, (): Result<Drawable> => {
    try {
      const type = graph.get<OmnigraphItemType>(ids.type);
      switch (type) {
        case "expression": {
          const vp = graph.get<Viewport>(containerIds.viewport);
          const color = graph.get<number>(ids.color);
          const path = sampleExprAdaptive(
            graph.get<string>(ids.expr),
            { min: vp.xMin, max: vp.xMax },
            CURVE_RESOLUTION,
            "x",
            {},
            color,
            {},
            { min: vp.yMin, max: vp.yMax },
          );
          return { ok: true, value: { kind: "path", path } };
        }
        case "parametric": {
          const domain = { min: bound(graph.get<string>(ids.tMin), "t-min"), max: bound(graph.get<string>(ids.tMax), "t-max") };
          if (domain.min >= domain.max) throw new Error("t-min must be less than t-max.");
          const path = sampleParametricCurve(graph.get<string>(ids.exprA), graph.get<string>(ids.exprB), domain, CURVE_RESOLUTION);
          return { ok: true, value: { kind: "path", path } };
        }
        case "polar": {
          const domain = { min: bound(graph.get<string>(ids.tMin), "θ-min"), max: bound(graph.get<string>(ids.tMax), "θ-max") };
          if (domain.min >= domain.max) throw new Error("θ-min must be less than θ-max.");
          const path = samplePolarCurve(graph.get<string>(ids.exprA), domain, CURVE_RESOLUTION);
          return { ok: true, value: { kind: "path", path } };
        }
        case "implicit": {
          const vp = graph.get<Viewport>(containerIds.viewport);
          const expr = graph.get<string>(ids.expr);
          const zero = equationToImplicitZero(preprocessImplicitMultiplication(expr));
          const segments = sampleImplicitCurve(zero, { min: vp.xMin, max: vp.xMax }, { min: vp.yMin, max: vp.yMax }, IMPLICIT_RESOLUTION);
          return { ok: true, value: { kind: "segments", segments, expr } };
        }
        case "complex": {
          const expr = Symbolic.parse(preprocessImplicitMultiplication(graph.get<string>(ids.expr)));
          const f = (z: ComplexNumber) => {
            const env: ComplexEnv = { z };
            return evaluateComplex(expr, env);
          };
          // Probe once so a bad expression fails HERE (into the row's own
          // error) rather than 90,000 times inside the raster loop.
          f(new ComplexNumber(0.5, 0.5));
          return { ok: true, value: { kind: "raster", f } };
        }
        default:
          throw new Error(`Item type "${type}" isn't available on the 2D surface yet.`);
      }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });
}

/** Seeds one row: item fields (omnigraph-items.ts) + this panel's own derived drawable cell. */
function seedRow(graph: CellGraph, rowId: string, containerIds: CellIdsOmnigraph, item: OmnigraphItem): void {
  seedOmnigraphRow(graph, rowId, item);
  defineRowDrawable(graph, rowId, containerIds);
}

/** Reads every row back into a serializable state -- shared by the URL-sync effect and (later) gallery save, so they can never disagree. */
export function getCurrentOmnigraphState(graph: CellGraph, containerIds: CellIdsOmnigraph): OmnigraphState {
  const items: OmnigraphItem[] = [];
  for (const rowId of graph.get<string[]>(containerIds.list)) {
    const item = readOmnigraphItem(graph, rowId);
    if (item) items.push(item);
  }
  return { version: 1, viewport: graph.get<Viewport>(containerIds.viewport), items };
}

/**
 * Pure re-render of the shared 2D surface, extracted so PngExportButton's
 * renderAtScale can call it against an offscreen canvas at any size (the
 * standard "extract a pure drawXxx" convention).
 *
 * Draw order: complex raster layers first in list order (background), then
 * axes, then curve items in list order. `livePreview` requests the
 * downscaled raster path for mid-gesture frames -- the exported PNG always
 * renders full resolution.
 */
export function drawOmnigraph2D(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  graph: CellGraph,
  containerIds: CellIdsOmnigraph,
  previewCanvas?: HTMLCanvasElement,
): void {
  ctx.clearRect(0, 0, width, height);
  const live = graph.get<Viewport | null>(containerIds.liveViewport);
  const vp = live ?? graph.get<Viewport>(containerIds.viewport);
  const rowIds = graph.get<string[]>(containerIds.list);

  // Background pass: complex domain-coloring layers, list order.
  for (const rowId of rowIds) {
    const ids = cellIdsOmnigraphRow(rowId);
    try {
      if (graph.get<OmnigraphItemType>(ids.type) !== "complex" || !graph.get<boolean>(ids.visible)) continue;
      const drawable = graph.get<Result<Drawable>>(ids.error);
      if (!drawable.ok || drawable.value.kind !== "raster") continue;
      if (live && previewCanvas) {
        const pw = Math.max(1, Math.round(width / LIVE_PREVIEW_DOWNSCALE));
        const ph = Math.max(1, Math.round(height / LIVE_PREVIEW_DOWNSCALE));
        previewCanvas.width = pw;
        previewCanvas.height = ph;
        const previewCtx = previewCanvas.getContext("2d");
        if (previewCtx) {
          renderDomainColoring(previewCtx, pw, ph, vp, drawable.value.f);
          ctx.drawImage(previewCanvas, 0, 0, pw, ph, 0, 0, width, height);
        }
      } else {
        renderDomainColoring(ctx, width, height, vp, drawable.value.f);
      }
    } catch {
      // Row mid-removal -- skip this frame.
    }
  }

  drawAxes(ctx, vp, width, height);

  // Curve pass, list order.
  for (const rowId of rowIds) {
    const ids = cellIdsOmnigraphRow(rowId);
    try {
      const type = graph.get<OmnigraphItemType>(ids.type);
      if (type === "complex" || !graph.get<boolean>(ids.visible)) continue;
      const drawable = graph.get<Result<Drawable>>(ids.error);
      if (!drawable.ok) continue;
      const color = graph.get<number>(ids.color);
      if (drawable.value.kind === "path") {
        drawPath(ctx, { ...drawable.value.path, stroke: { ...drawable.value.path.stroke, color } }, vp, width, height);
      } else if (drawable.value.kind === "segments") {
        drawImplicitCurve(ctx, drawable.value.segments, vp, width, height, `#${color.toString(16).padStart(6, "0")}`);
      }
    } catch {
      // Row mid-removal -- skip this frame.
    }
  }
}

function useOmnigraphGraph(containerId: string): { graph: CellGraph; containerIds: CellIdsOmnigraph } {
  // containerIds memoized on the ref itself, same as every other multi-row
  // panel's useXxxGraph (the factory returns a fresh object per call, which
  // would defeat effect dep arrays).
  const ref = useRef<{ graph: CellGraph; containerIds: CellIdsOmnigraph } | null>(null);
  if (!ref.current) {
    const containerIds = cellIdsOmnigraph(containerId);
    const graph = new CellGraph();
    if (!graph.hasValue(containerIds.list)) {
      const decoded = typeof window !== "undefined" ? decodeOmnigraphState(window.location.hash.slice(1)) : null;
      const state = decoded ?? DEFAULT_OMNIGRAPH_STATE;
      graph.set(containerIds.viewport, state.viewport, { auxiliary: true });
      graph.set<Viewport | null>(containerIds.liveViewport, null, { auxiliary: true });
      const rowIds: string[] = [];
      for (const item of state.items) {
        const rowId = crypto.randomUUID();
        seedRow(graph, rowId, containerIds, item);
        rowIds.push(rowId);
      }
      graph.set(containerIds.list, rowIds, { auxiliary: true });
    }
    ref.current = { graph, containerIds };
  }
  return ref.current;
}

/** One item row's controls: type dropdown + the minimal per-type field editors + shared visible/color/remove. */
function OmnigraphRow({
  graph,
  rowId,
  containerIds,
  onRemove,
}: {
  graph: CellGraph;
  rowId: string;
  containerIds: CellIdsOmnigraph;
  onRemove?: () => void;
}) {
  const ids = cellIdsOmnigraphRow(rowId);
  const type = useCell<OmnigraphItemType>(graph, ids.type);
  const visible = useCell<boolean>(graph, ids.visible);
  const drawable = useCell<Result<Drawable>>(graph, ids.error);
  // Not every type has every cell -- read optional fields defensively via
  // hasValue-guarded snapshots rather than useCell (a useCell on a cell
  // that a type switch later deletes... they're never deleted mid-life, but
  // a cell that was never seeded for this type would be created empty by
  // the read; version-subscribing to `type` above already re-renders this
  // row on any switch, and the drawable cell re-renders it on any field
  // edit, so plain reads stay fresh).
  const color = graph.hasValue(ids.color) ? graph.get<number>(ids.color) : 0x2563eb;

  function field(cellId: string, label: string, width = "12ch") {
    const value = graph.hasValue(cellId) ? graph.get<string>(cellId) : "";
    return (
      <label>
        {label}{" "}
        <input value={value} onChange={(e) => graph.set(cellId, e.target.value)} style={{ font: "inherit", width }} />
      </label>
    );
  }

  function switchType(next: OmnigraphItemType) {
    const index = graph.get<string[]>(containerIds.list).indexOf(rowId);
    const keepColor = graph.hasValue(ids.color) ? graph.get<number>(ids.color) : paletteColor(Math.max(0, index));
    const item = defaultOmnigraphItem(next, keepColor);
    seedRow(graph, rowId, containerIds, item);
  }

  return (
    <div style={{ margin: "0.35rem 0", padding: "0.35rem", border: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
        <input type="checkbox" checked={visible} onChange={(e) => graph.set(ids.visible, e.target.checked)} title="Show/hide this item" />
        <select value={type} onChange={(e) => switchType(e.target.value as OmnigraphItemType)} title="Item type -- switching re-seeds this row with the new type's default">
          {AVAILABLE_TYPES.map((t) => (
            <option key={t} value={t}>
              {OMNIGRAPH_ITEM_TYPES[t].label}
            </option>
          ))}
        </select>
        {type !== "complex" && (
          <input
            type="color"
            value={`#${color.toString(16).padStart(6, "0")}`}
            onChange={(e) => graph.set(ids.color, Number.parseInt(e.target.value.slice(1), 16))}
          />
        )}
        {onRemove && (
          <button type="button" onClick={onRemove} title="Remove this item">
            ✕
          </button>
        )}
      </div>
      <div style={{ margin: "0.25rem 0", display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {type === "expression" && field(ids.expr, "y =", "20ch")}
        {type === "parametric" && (
          <>
            {field(ids.exprA, "x(t) =")}
            {field(ids.exprB, "y(t) =")}
            {field(ids.tMin, "t ∈ [", "6ch")}
            {field(ids.tMax, ",", "6ch")}
          </>
        )}
        {type === "polar" && (
          <>
            {field(ids.exprA, "r(t) =", "16ch")}
            {field(ids.tMin, "θ ∈ [", "6ch")}
            {field(ids.tMax, ",", "6ch")}
          </>
        )}
        {type === "implicit" && field(ids.expr, "equation:", "20ch")}
        {type === "complex" && (
          <>
            {field(ids.expr, "f(z) =", "16ch")}
            <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>renders as a background layer</span>
          </>
        )}
      </div>
      {!drawable.ok && <p style={{ color: "var(--danger)", fontSize: "0.8rem", margin: "0.15rem 0" }}>{drawable.message}</p>}
    </div>
  );
}

export interface OmnigraphPanelProps {
  cellId?: string;
}

/**
 * The Omnigraph panel -- see this file's own top doc comment. Gesture
 * handling (pan/pinch/wheel with committed-vs-live viewport split) is
 * ParametricPanel's own, verbatim in structure.
 */
export function OmnigraphPanel({ cellId = "omnigraph-1" }: OmnigraphPanelProps = {}) {
  const { graph, containerIds } = useOmnigraphGraph(cellId);
  useCellGraphTools(`omnigraph_${cellId}`, graph);
  const rowIds = useCell<string[]>(graph, containerIds.list);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const committedViewport = useCell<Viewport>(graph, containerIds.viewport);
  const liveViewport = useCell<Viewport | null>(graph, containerIds.liveViewport);
  const viewport = liveViewport ?? committedViewport;

  const gestureRef = useRef<
    | { kind: "pan"; anchorX: number; anchorY: number; spanX: number; spanY: number }
    | { kind: "pinch"; anchorX: number; anchorY: number; spanX: number; spanY: number; startDistancePx: number }
    | null
  >(null);
  const activePointersRef = useRef<Map<number, { sx: number; sy: number }>>(new Map());
  const zoomCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function addItem(type: OmnigraphItemType = "expression") {
    const { id, index } = appendRow(graph, containerIds.list);
    seedRow(graph, id, containerIds, defaultOmnigraphItem(type, paletteColor(index)));
  }

  function removeItem(rowId: string) {
    removeRow(graph, containerIds.list, rowId, cellIdsOmnigraphRow(rowId));
  }

  useModelContextTool({
    name: `omnigraph_${cellId}_add_item`,
    description: `Add an item to the Omnigraph surface. Types available: ${AVAILABLE_TYPES.join(", ")}. The new row seeds that type's default; edit its cells afterward via omnigraph_${cellId}_set_cell (list cells with omnigraph_${cellId}_list_cells).`,
    inputSchema: {
      type: "object",
      properties: { itemType: { type: "string", enum: AVAILABLE_TYPES } },
      required: ["itemType"],
    },
    handler: async (input: Record<string, unknown>) => {
      const type = input.itemType as OmnigraphItemType;
      if (!AVAILABLE_TYPES.includes(type)) return { error: `unknown/unavailable item type "${String(input.itemType)}"` };
      addItem(type);
      return { added: type, rowCount: graph.get<string[]>(containerIds.list).length };
    },
  });

  // Single redraw effect over subscribeAll -- dynamic row count, same
  // reasoning as every other multi-row panel.
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    if (!previewCanvasRef.current && typeof document !== "undefined") previewCanvasRef.current = document.createElement("canvas");
    const redraw = () => drawOmnigraph2D(ctx, WIDTH, HEIGHT, graph, containerIds, previewCanvasRef.current ?? undefined);
    redraw();
    return graph.subscribeAll(redraw);
  }, [graph, containerIds]);

  // URL sync -- rows/viewport in, hash out, same shape as GraphCanvasMulti.
  useEffect(() => {
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeOmnigraphState(getCurrentOmnigraphState(graph, containerIds))}`);
    }
    writeUrl();
    return graph.subscribeAll(writeUrl);
  }, [graph, containerIds]);

  useEffect(() => {
    return () => {
      if (zoomCommitTimerRef.current) clearTimeout(zoomCommitTimerRef.current);
    };
  }, []);

  function commitLiveViewport() {
    const live = graph.get<Viewport | null>(containerIds.liveViewport);
    if (!live) return;
    graph.set(containerIds.viewport, live);
    graph.set<Viewport | null>(containerIds.liveViewport, null);
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
      const vp = graph.get<Viewport | null>(containerIds.liveViewport) ?? graph.get<Viewport>(containerIds.viewport);
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

    const vp = graph.get<Viewport>(containerIds.viewport);
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
      graph.set(containerIds.liveViewport, viewportFromAnchor(gesture.anchorX, gesture.anchorY, midSx, midSy, spanX, spanY, WIDTH, HEIGHT));
      return;
    }
    const { sx, sy } = canvasEventPoint(e, e.currentTarget, WIDTH, HEIGHT);
    graph.set(containerIds.liveViewport, viewportFromAnchor(gesture.anchorX, gesture.anchorY, sx, sy, gesture.spanX, gesture.spanY, WIDTH, HEIGHT));
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLCanvasElement>) {
    activePointersRef.current.delete(e.pointerId);
    if (gestureRef.current?.kind === "pan" || gestureRef.current?.kind === "pinch") commitLiveViewport();
    gestureRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  function handleWheel(e: WheelEvent) {
    if (!canvasRef.current) return;
    e.preventDefault();
    const vp = graph.get<Viewport | null>(containerIds.liveViewport) ?? graph.get<Viewport>(containerIds.viewport);
    const { sx, sy } = canvasEventPoint(e, canvasRef.current, WIDTH, HEIGHT);
    const anchorX = toDataX(sx, vp, WIDTH);
    const anchorY = toDataY(sy, vp, HEIGHT);
    const factor = wheelZoomFactor(e.deltaY, ZOOM_STEP);
    const spanX = (vp.xMax - vp.xMin) * factor;
    const spanY = (vp.yMax - vp.yMin) * factor;
    graph.set(containerIds.liveViewport, viewportFromAnchor(anchorX, anchorY, sx, sy, spanX, spanY, WIDTH, HEIGHT));
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
    graph.set<Viewport | null>(containerIds.liveViewport, null);
    graph.set(containerIds.viewport, DEFAULT_OMNIGRAPH_VIEWPORT);
  }

  return (
    <div>
      <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0 0 0.5rem" }}>
        Every graph type on one surface: add items and pick each one's type from its dropdown. Complex-coloring items render as background
        layers in list order. 3D item types arrive in a later phase -- the surface will upgrade to a 3D scene when one exists.
      </p>
      {rowIds.map((rowId) => (
        <OmnigraphRow key={rowId} graph={graph} rowId={rowId} containerIds={containerIds} onRemove={rowIds.length > 1 ? () => removeItem(rowId) : undefined} />
      ))}
      <button type="button" onClick={() => addItem()} style={{ margin: "0.35rem 0" }}>
        + Add item
      </button>
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        style={{ border: "1px solid var(--border)", touchAction: "none", maxWidth: "100%" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
      <div style={{ margin: "0.25rem 0" }}>
        <PngExportButton
          getCanvas={() => canvasRef.current}
          label="omnigraph"
          renderAtScale={(ctx, width, height) => drawOmnigraph2D(ctx, width, height, graph, containerIds)}
          baseWidth={WIDTH}
          baseHeight={HEIGHT}
        />{" "}
        <button type="button" onClick={resetView}>
          Reset view
        </button>
      </div>
      <p style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
        Viewport: x ∈ [{viewport.xMin.toFixed(2)}, {viewport.xMax.toFixed(2)}], y ∈ [{viewport.yMin.toFixed(2)}, {viewport.yMax.toFixed(2)}]
      </p>
    </div>
  );
}
