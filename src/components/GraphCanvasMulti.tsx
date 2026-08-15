import type { Path2D } from "mallory-math";
import { useServerFn } from "@tanstack/react-start";
import { type PointerEvent, useEffect, useRef, useState, type WheelEvent } from "react";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsMultiRow, EXPRESSION_LIST_CELL, VIEWPORT_CELL } from "../lib/cell-ids.ts";
import { evaluateExactAt } from "../lib/exact-eval.ts";
import {
  DEFAULT_MULTI_GRAPH_STATE,
  decodeMultiGraphState,
  encodeMultiGraphState,
  type MultiGraphAnnotation,
  type MultiGraphState,
} from "../lib/multi-graph-state.ts";
import { drawExpressionLayer, drawOpenCircles, drawPath, drawPoint, drawScatter, type Viewport } from "../lib/render-path.ts";
import { findNearestPointOnRows, type PointReadout } from "../lib/point-readout.ts";
import { isCoarsePointer } from "../lib/pointer-media.ts";
import { PngExportButton } from "./PngExportButton.tsx";
import { saveGraph } from "../lib/saved-graphs.ts";
import { findIntersections } from "../lib/sample-function.ts";
import { getThemeColors } from "../lib/theme-colors.ts";
import { canvasEventPoint, toDataX, toDataY, toScreenX, toScreenY } from "../lib/viewport.ts";
import { ExpressionRow } from "./ExpressionRow.tsx";
import { useCell } from "../lib/use-cell.ts";
import { useUndoHistory } from "../hooks/use-undo-history.ts";

const WIDTH = 600;
const HEIGHT = 600;
const ANNOTATION_HIT_RADIUS_PX = 10;
// A touch tap is a much less precise target than a mouse click -- issue
// #53. Both hit-test call sites below multiply by this factor on a coarse
// pointer (isCoarsePointer(), read once per hit test since it's a live
// media-query match, not something to cache/go stale).
const COARSE_POINTER_HIT_RADIUS_MULTIPLIER = 2.5;

// Not namespaced by any row id -- one shared annotation list per view,
// mirroring EXPRESSION_LIST_CELL's own "one shared, unnamespaced list" shape.
const ANNOTATIONS_CELL = "annotations";

// Derived (graph.define'd), not user-set -- every pairwise crossing among
// currently-visible rows, over the shared viewport's x-range. Read fresh
// from each row's expr/params rather than its already-adaptively-sampled
// Path2D (see findIntersections' own doc comment for why).
const INTERSECTIONS_CELL = "intersections";

// The last point read via "Read point" mode -- ephemeral UI state (not part
// of multi-graph-state.ts's persisted schema), holding the nearest sampled
// point among all visible rows to the click, or null once cleared/nothing
// was close enough. See point-readout.ts's own doc comment for the
// screen-space-nearest-match reasoning.
const POINT_READOUT_CELL = "pointReadout";

// Float/exact evaluation mode (issue #51's first parity item, porting
// GraphCanvas's own mode toggle): shared across every row, unlike a
// per-row setting, matching the ticket's own framing. A CellGraph cell
// (not plain React state, unlike annotating/readingPoint's ephemeral UI
// toggles) specifically so it rides the existing subscribeAll-driven
// writeUrl effect for free and round-trips through multi-graph-state.ts,
// the same way GraphCanvas's own mode persists to ITS URL state.
const MODE_CELL = "mode";

// The in-progress viewport during an active pan/zoom gesture, or null when
// idle -- issue #52's debounced-refinement fix. `VIEWPORT_CELL` is the
// "committed, sampled" viewport every row's ids.path depends on (still only
// touched at gesture END); this cell is read ONLY by redraw() below to
// reproject each row's already-sampled Path2D through the live gesture
// position, at zero resampling cost -- toScreenX/toScreenY handle both
// translation (pan) and rescaling (zoom) purely at draw time, so panning
// and zooming stay responsive without CellGraph recomputing every visible
// curve's sampleExprAdaptive call on every pointermove/wheel tick.
// Known tradeoff, matching the ticket's own suggested approach: panning/
// zooming far enough to reveal x beyond what was sampled at gesture start
// shows nothing there until the gesture-end commit resamples -- the same
// "pan then fill in, zoom then sharpen" behavior common to interactive
// graphing/mapping tools, not attempted to be hidden with sampling margin.
const LIVE_VIEWPORT_CELL = "liveViewport";

// Cycled by index (mod length) as rows are added -- not meant to be a large
// or exhaustive palette, just enough that a handful of curves stay visually
// distinguishable before a user reaches for the color picker themselves.
const PALETTE = [0x2563eb, 0xdc2626, 0x16a34a, 0xd97706, 0x9333ea, 0x0891b2];

/** Builds the full serializable state of a multi-graph -- shared by the URL-sync effect and the save-to-gallery handler. */
function getCurrentMultiGraphState(graph: CellGraph): MultiGraphState {
  const rowIds = graph.get<string[]>(EXPRESSION_LIST_CELL);
  const rows = rowIds.map((id) => {
    const ids = cellIdsMultiRow(id);
    const freeVars = graph.hasValue(ids.freeVars) ? graph.get<string[]>(ids.freeVars) : [];
    const params: Record<string, number> = {};
    for (const name of freeVars) params[name] = graph.get<number>(ids.param(name));
    return {
      source: graph.get<string>(ids.expr),
      color: graph.get<number>(ids.color),
      visible: graph.get<boolean>(ids.visible),
      params,
    };
  });
  return {
    v: 1,
    rows,
    viewport: graph.get<Viewport>(VIEWPORT_CELL),
    annotations: graph.get<MultiGraphAnnotation[]>(ANNOTATIONS_CELL),
    mode: graph.get<"float" | "exact">(MODE_CELL),
  };
}

function seedRow(
  graph: CellGraph,
  rowId: string,
  source: string,
  color: number,
  visible: boolean,
  params: Record<string, number> = {},
): void {
  const ids = cellIdsMultiRow(rowId);
  graph.set(ids.expr, source);
  graph.set(ids.color, color);
  graph.set(ids.visible, visible);
  for (const [name, value] of Object.entries(params)) graph.set(ids.param(name), value);
}

/**
 * Applies a previously-snapshotted MultiGraphState back onto the live graph
 * (undo/redo, issue #43). Follows `removeRow`'s documented ordering: the new
 * rows are seeded and EXPRESSION_LIST_CELL swapped to them FIRST, so the
 * redraw/URL-sync listeners that fire synchronously never observe a list
 * entry whose cells are already deleted -- only then are the old rows' cells
 * deleted (params before the fixed cells, same as removeRow).
 */
function restoreMultiGraphState(graph: CellGraph, state: MultiGraphState): void {
  const oldIds = graph.get<string[]>(EXPRESSION_LIST_CELL);
  const newIds = state.rows.map(() => crypto.randomUUID());
  newIds.forEach((id, i) => {
    const row = state.rows[i] as MultiGraphState["rows"][number];
    seedRow(graph, id, row.source, row.color, row.visible, row.params);
  });
  graph.set(VIEWPORT_CELL, state.viewport);
  graph.set<Viewport | null>(LIVE_VIEWPORT_CELL, null);
  graph.set(ANNOTATIONS_CELL, state.annotations ?? []);
  graph.set(MODE_CELL, state.mode ?? "float");
  graph.set(EXPRESSION_LIST_CELL, newIds);
  for (const id of oldIds) {
    const ids = cellIdsMultiRow(id);
    const freeVars = graph.hasValue(ids.freeVars) ? graph.get<string[]>(ids.freeVars) : [];
    for (const name of freeVars) graph.delete(ids.param(name));
    for (const cellId of Object.values(ids)) {
      if (typeof cellId === "string") graph.delete(cellId);
    }
  }
}

/**
 * One shared CellGraph, one shared VIEWPORT_CELL, and an ordered
 * EXPRESSION_LIST_CELL of row ids -- each row's own cells (see
 * ExpressionRow.tsx's `useRowCells`) read the shared viewport, so
 * drag-to-pan/wheel-to-zoom (see `handleCanvasPointerMove`/
 * `handleCanvasWheel`) moves every curve at once, exactly the
 * shared-conductor design the Wave 2 design anticipated.
 * This is the actual "multiple curves, one graph" capability that
 * GraphCanvas/LinkedGraphPanes don't have: LinkedGraphPanes shares one
 * CellGraph too, but each pane still owns its own separate `<canvas>` and
 * viewport.
 *
 * Hydrates from the URL hash (multi-graph-state.ts) when present, the same
 * "no server round-trip" convention GraphCanvas's own single-pane state
 * uses -- which also makes "fork this view" (see `forkView` below) trivial:
 * since the current state is always live in the URL, opening that same URL
 * in a new tab *is* the fork.
 */
function useMultiGraph(): CellGraph {
  const ref = useRef<CellGraph | null>(null);
  if (!ref.current) {
    const graph = new CellGraph();
    const decoded = typeof window !== "undefined" ? decodeMultiGraphState(window.location.hash.slice(1)) : null;
    const state = decoded ?? DEFAULT_MULTI_GRAPH_STATE;
    graph.set(VIEWPORT_CELL, state.viewport, { auxiliary: true });
    graph.set<Viewport | null>(LIVE_VIEWPORT_CELL, null, { auxiliary: true });
    const initialIds = state.rows.map(() => crypto.randomUUID());
    initialIds.forEach((id, i) => {
      const row = state.rows[i] as MultiGraphState["rows"][number];
      seedRow(graph, id, row.source, row.color, row.visible, row.params);
    });
    graph.set(EXPRESSION_LIST_CELL, initialIds, { auxiliary: true });
    graph.set(ANNOTATIONS_CELL, state.annotations ?? [], { auxiliary: true });
    graph.set(POINT_READOUT_CELL, null, { auxiliary: true });
    graph.set<"float" | "exact">(MODE_CELL, state.mode ?? "float", { auxiliary: true });

    graph.define(
      INTERSECTIONS_CELL,
      (): { x: number; y: number }[] => {
        const rowIds = graph.get<string[]>(EXPRESSION_LIST_CELL);
        const viewport = graph.get<Viewport>(VIEWPORT_CELL);
        const visibleRows = rowIds
          .map((id) => cellIdsMultiRow(id))
          .filter((rowCellIds) => graph.hasValue(rowCellIds.expr) && graph.get<boolean>(rowCellIds.visible));
        const points: { x: number; y: number }[] = [];
        for (let i = 0; i < visibleRows.length; i++) {
          for (let j = i + 1; j < visibleRows.length; j++) {
            const a = visibleRows[i] as ReturnType<typeof cellIdsMultiRow>;
            const b = visibleRows[j] as ReturnType<typeof cellIdsMultiRow>;
            try {
              const exprA = graph.get<string>(a.expr);
              const paramsA = graph.hasValue(a.params) ? graph.get<Record<string, number>>(a.params) : {};
              const exprB = graph.get<string>(b.expr);
              const paramsB = graph.hasValue(b.params) ? graph.get<Record<string, number>>(b.params) : {};
              points.push(
                ...findIntersections(exprA, paramsA, exprB, paramsB, { min: viewport.xMin, max: viewport.xMax }),
              );
            } catch {
              // One row's expression doesn't parse mid-typing -- skip this pair this recompute.
            }
          }
        }
        return points;
      },
      { auxiliary: true },
    );

    ref.current = graph;
  }
  return ref.current;
}

export function GraphCanvasMulti() {
  const graph = useMultiGraph();
  const rowIds = useCell<string[]>(graph, EXPRESSION_LIST_CELL);
  const annotations = useCell<MultiGraphAnnotation[]>(graph, ANNOTATIONS_CELL);
  const pointReadout = useCell<PointReadout | null>(graph, POINT_READOUT_CELL);
  const mode = useCell<"float" | "exact">(graph, MODE_CELL);
  const history = useUndoHistory(
    graph,
    () => getCurrentMultiGraphState(graph),
    (state) => restoreMultiGraphState(graph, state),
  );
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [annotating, setAnnotating] = useState(false);
  const [readingPoint, setReadingPoint] = useState(false);
  const [readoutMissed, setReadoutMissed] = useState(false);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  // A single gesture is either dragging one annotation, panning the shared
  // viewport with one pointer, or pinch-zooming with two -- never more than
  // one at once, so one ref (not several) tracks whichever is active.
  const dragRef = useRef<
    | { kind: "annotation"; id: string }
    | { kind: "pan"; anchorX: number; anchorY: number; spanX: number; spanY: number }
    | { kind: "pinch"; anchorX: number; anchorY: number; spanX: number; spanY: number; startDistancePx: number }
    | null
  >(null);
  // Every currently-down pointer's canvas-space position, keyed by pointerId
  // -- issue #53's pinch-to-zoom: a single PointerEvent only reports the ONE
  // pointer that moved, but computing the pinch distance/midpoint needs BOTH
  // touches' current positions, so each pointermove updates this map and
  // reads its sibling finger's last-known position back out of it.
  const activePointersRef = useRef<Map<number, { sx: number; sy: number }>>(new Map());
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const saveGraphFn = useServerFn(saveGraph);

  async function handleSave() {
    const title = window.prompt("Title for this saved graph:", "Untitled");
    if (title === null) return;
    setSaveStatus("Saving…");
    try {
      await saveGraphFn({ data: { title, kind: "multi", state: getCurrentMultiGraphState(graph) } });
      setSaveStatus(`Saved as "${title || "Untitled"}" — see the gallery to reopen it.`);
    } catch (e) {
      setSaveStatus(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function addRow() {
    const id = crypto.randomUUID();
    const current = graph.get<string[]>(EXPRESSION_LIST_CELL);
    seedRow(graph, id, "x", PALETTE[current.length % PALETTE.length] as number, true);
    graph.set(EXPRESSION_LIST_CELL, [...current, id]);
  }

  // Removes the row from the shared list FIRST (so the redraw/URL-sync
  // listeners that fire synchronously on that set no longer read the row),
  // then deletes the row's own cells -- previously they were left as
  // permanent orphans. Deleting expr/params also marks INTERSECTIONS_CELL
  // dirty (CellGraph.delete notifies former dependents), so stale
  // intersection markers involving the removed curve recompute away.
  function removeRow(id: string) {
    graph.set(
      EXPRESSION_LIST_CELL,
      graph.get<string[]>(EXPRESSION_LIST_CELL).filter((existing) => existing !== id),
    );
    const ids = cellIdsMultiRow(id);
    const freeVars = graph.hasValue(ids.freeVars) ? graph.get<string[]>(ids.freeVars) : [];
    for (const name of freeVars) graph.delete(ids.param(name));
    for (const cellId of Object.values(ids)) {
      if (typeof cellId === "string") graph.delete(cellId);
    }
  }

  function forkView() {
    window.open(window.location.href, "_blank");
  }

  function canvasToDataCoords(e: PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const viewport = graph.get<Viewport>(VIEWPORT_CELL);
    const { sx, sy } = canvasEventPoint(e, e.currentTarget, WIDTH, HEIGHT);
    return {
      x: toDataX(sx, viewport, WIDTH),
      y: toDataY(sy, viewport, HEIGHT),
    };
  }

  /** Nearest annotation within a fixed pixel hit radius (widened on a coarse/touch pointer), or null if none is close enough. */
  function hitTestAnnotation(x: number, y: number): MultiGraphAnnotation | null {
    const viewport = graph.get<Viewport>(VIEWPORT_CELL);
    const hitRadiusPx = isCoarsePointer() ? ANNOTATION_HIT_RADIUS_PX * COARSE_POINTER_HIT_RADIUS_MULTIPLIER : ANNOTATION_HIT_RADIUS_PX;
    const hitDataRadius = (hitRadiusPx / WIDTH) * (viewport.xMax - viewport.xMin);
    let closest: MultiGraphAnnotation | null = null;
    let bestDist = hitDataRadius;
    for (const a of annotations) {
      const d = Math.hypot(a.x - x, a.y - y);
      if (d < bestDist) {
        bestDist = d;
        closest = a;
      }
    }
    return closest;
  }

  function handleCanvasPointerDown(e: PointerEvent<HTMLCanvasElement>) {
    // Flush any pending zoom-debounce commit first: a scroll-then-immediately-
    // drag sequence could otherwise start the new pan's anchor capture (a few
    // lines down, and readingPoint's own VIEWPORT_CELL read above) against a
    // stale pre-zoom VIEWPORT_CELL while the zoomed position only exists in
    // LIVE_VIEWPORT_CELL, producing a visible jump when the pan starts.
    if (zoomCommitTimerRef.current) {
      clearTimeout(zoomCommitTimerRef.current);
      zoomCommitTimerRef.current = null;
    }
    commitLiveViewport();

    const downPoint = canvasEventPoint(e, e.currentTarget, WIDTH, HEIGHT);
    activePointersRef.current.set(e.pointerId, downPoint);

    if (activePointersRef.current.size >= 2) {
      // Pinch-to-zoom (issue #53): a second finger touching down while one
      // is already active starts (or re-anchors, if a third finger lands
      // too) a pinch, overriding whatever single-pointer gesture (pan/
      // annotation-drag/read-point) was in progress -- picks the two most
      // recently added touches so a stray third finger doesn't wedge the
      // gesture on two stale positions.
      const [p1, p2] = [...activePointersRef.current.values()].slice(-2) as [{ sx: number; sy: number }, { sx: number; sy: number }];
      const midSx = (p1.sx + p2.sx) / 2;
      const midSy = (p1.sy + p2.sy) / 2;
      const viewport = graph.get<Viewport | null>(LIVE_VIEWPORT_CELL) ?? graph.get<Viewport>(VIEWPORT_CELL);
      dragRef.current = {
        kind: "pinch",
        anchorX: toDataX(midSx, viewport, WIDTH),
        anchorY: toDataY(midSy, viewport, HEIGHT),
        spanX: viewport.xMax - viewport.xMin,
        spanY: viewport.yMax - viewport.yMin,
        startDistancePx: Math.hypot(p1.sx - p2.sx, p1.sy - p2.sy),
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    if (readingPoint) {
      const viewport = graph.get<Viewport>(VIEWPORT_CELL);
      const { sx, sy } = canvasEventPoint(e, e.currentTarget, WIDTH, HEIGHT);
      const candidates = graph
        .get<string[]>(EXPRESSION_LIST_CELL)
        .map((rowId) => ({ rowId, ids: cellIdsMultiRow(rowId) }))
        .filter(({ ids }) => graph.hasValue(ids.path) && graph.get<boolean>(ids.visible))
        .map(({ rowId, ids }) => ({
          rowId,
          path: graph.get<Path2D>(ids.path),
          color: graph.get<number>(ids.color),
        }));
      const readoutHitRadius = isCoarsePointer() ? 20 * COARSE_POINTER_HIT_RADIUS_MULTIPLIER : 20;
      const result = findNearestPointOnRows(candidates, sx, sy, viewport, WIDTH, HEIGHT, readoutHitRadius);
      graph.set(POINT_READOUT_CELL, result, { auxiliary: true });
      setReadoutMissed(result === null);
      setReadingPoint(false);
      return;
    }
    const { x, y } = canvasToDataCoords(e);
    if (annotating) {
      const label = window.prompt("Label this point:", `Note ${annotations.length + 1}`);
      if (label === null) return; // cancelled
      graph.set(ANNOTATIONS_CELL, [...annotations, { id: crypto.randomUUID(), x, y, label }]);
      setAnnotating(false);
      return;
    }
    const hit = hitTestAnnotation(x, y);
    if (hit) {
      setSelectedAnnotationId(hit.id);
      dragRef.current = { kind: "annotation", id: hit.id };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    setSelectedAnnotationId(null);
    // Anchor the data point currently under the cursor -- every subsequent
    // pointermove recomputes the viewport from scratch so that same data
    // point stays under the cursor, rather than accumulating per-frame
    // deltas (which would drift under rounding error over a long drag).
    const viewport = graph.get<Viewport>(VIEWPORT_CELL);
    dragRef.current = {
      kind: "pan",
      anchorX: x,
      anchorY: y,
      spanX: viewport.xMax - viewport.xMin,
      spanY: viewport.yMax - viewport.yMin,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handleCanvasPointerMove(e: PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    if (activePointersRef.current.has(e.pointerId)) {
      activePointersRef.current.set(e.pointerId, canvasEventPoint(e, e.currentTarget, WIDTH, HEIGHT));
    }
    if (drag.kind === "annotation") {
      const { x, y } = canvasToDataCoords(e);
      graph.set(
        ANNOTATIONS_CELL,
        annotations.map((a) => (a.id === drag.id ? { ...a, x, y } : a)),
      );
      return;
    }
    if (drag.kind === "pinch") {
      // Only the ONE pointer that generated this event is in `e` -- both
      // touches' up-to-date positions come back out of activePointersRef,
      // updated by every pointermove above (including the sibling finger's
      // own events).
      const points = [...activePointersRef.current.values()].slice(-2);
      if (points.length < 2) return; // a finger lifted without a matching pointerup somehow -- ignore this tick
      const [p1, p2] = points as [{ sx: number; sy: number }, { sx: number; sy: number }];
      const currentDistancePx = Math.hypot(p1.sx - p2.sx, p1.sy - p2.sy);
      if (currentDistancePx < 1) return; // fingers overlapping -- avoid a near-zero-divide factor spike
      // Fingers moving apart (currentDistancePx grows) -> factor < 1 -> the
      // span shrinks -> zoom IN, matching the pinch-out convention every
      // touch UI uses. Same formula as handleCanvasWheel, anchored at the
      // pinch's own midpoint fixed at gesture start (drag.anchorX/Y) rather
      // than re-read every tick, matching how panning anchors too.
      const factor = drag.startDistancePx / currentDistancePx;
      const spanX = drag.spanX * factor;
      const spanY = drag.spanY * factor;
      const midSx = (p1.sx + p2.sx) / 2;
      const midSy = (p1.sy + p2.sy) / 2;
      const xMin = drag.anchorX - (midSx / WIDTH) * spanX;
      const yMin = drag.anchorY - ((HEIGHT - midSy) / HEIGHT) * spanY;
      graph.set(LIVE_VIEWPORT_CELL, { xMin, xMax: xMin + spanX, yMin, yMax: yMin + spanY });
      return;
    }
    const { sx, sy } = canvasEventPoint(e, e.currentTarget, WIDTH, HEIGHT);
    const xMin = drag.anchorX - (sx / WIDTH) * drag.spanX;
    const yMin = drag.anchorY - ((HEIGHT - sy) / HEIGHT) * drag.spanY;
    // Live-only write (issue #52): every visible curve's ids.path depends on
    // VIEWPORT_CELL, not this cell, so panning stays a pure redraw -- zero
    // resampling -- for the whole gesture. Committed to VIEWPORT_CELL (the
    // one real resample) on pointerup below.
    graph.set(LIVE_VIEWPORT_CELL, { xMin, xMax: xMin + drag.spanX, yMin, yMax: yMin + drag.spanY });
  }

  function handleCanvasPointerUp(e: PointerEvent<HTMLCanvasElement>) {
    activePointersRef.current.delete(e.pointerId);
    if (dragRef.current?.kind === "pan" || dragRef.current?.kind === "pinch") commitLiveViewport();
    dragRef.current = null;
  }

  /** Copies a pending LIVE_VIEWPORT_CELL override into the real, sampled VIEWPORT_CELL (the gesture-end resample) and clears the override -- shared by pan-release and the wheel-zoom debounce below. */
  function commitLiveViewport() {
    const live = graph.get<Viewport | null>(LIVE_VIEWPORT_CELL);
    if (!live) return;
    graph.set(VIEWPORT_CELL, live);
    graph.set<Viewport | null>(LIVE_VIEWPORT_CELL, null);
  }

  const ZOOM_STEP = 1.1;
  const ZOOM_COMMIT_DEBOUNCE_MS = 150;
  const zoomCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Wheel-to-zoom, anchored on the cursor's data point (same anchor
   * technique as panning). Also live-only (issue #52): a trackpad's
   * continuous scroll has no discrete "gesture end" event the way a pan's
   * pointerup does, so the real VIEWPORT_CELL commit (the resample) is
   * debounced instead -- fires `ZOOM_COMMIT_DEBOUNCE_MS` after the last
   * wheel event, reset on every new one, same idea as a search-box's
   * debounced fetch.
   */
  function handleCanvasWheel(e: WheelEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const viewport = graph.get<Viewport | null>(LIVE_VIEWPORT_CELL) ?? graph.get<Viewport>(VIEWPORT_CELL);
    const { sx, sy } = canvasEventPoint(e, e.currentTarget, WIDTH, HEIGHT);
    const anchorX = toDataX(sx, viewport, WIDTH);
    const anchorY = toDataY(sy, viewport, HEIGHT);
    const factor = e.deltaY > 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    const spanX = (viewport.xMax - viewport.xMin) * factor;
    const spanY = (viewport.yMax - viewport.yMin) * factor;
    const xMin = anchorX - (sx / WIDTH) * spanX;
    const yMin = anchorY - ((HEIGHT - sy) / HEIGHT) * spanY;
    graph.set(LIVE_VIEWPORT_CELL, { xMin, xMax: xMin + spanX, yMin, yMax: yMin + spanY });
    if (zoomCommitTimerRef.current) clearTimeout(zoomCommitTimerRef.current);
    zoomCommitTimerRef.current = setTimeout(() => {
      zoomCommitTimerRef.current = null;
      commitLiveViewport();
    }, ZOOM_COMMIT_DEBOUNCE_MS);
  }

  useEffect(() => {
    return () => {
      if (zoomCommitTimerRef.current) clearTimeout(zoomCommitTimerRef.current);
    };
  }, []);

  function resetView() {
    if (zoomCommitTimerRef.current) {
      clearTimeout(zoomCommitTimerRef.current);
      zoomCommitTimerRef.current = null;
    }
    graph.set<Viewport | null>(LIVE_VIEWPORT_CELL, null);
    graph.set(VIEWPORT_CELL, DEFAULT_MULTI_GRAPH_STATE.viewport);
  }

  function updateAnnotationLabel(id: string, label: string) {
    graph.set(
      ANNOTATIONS_CELL,
      annotations.map((a) => (a.id === id ? { ...a, label } : a)),
    );
  }

  function removeAnnotation(id: string) {
    if (selectedAnnotationId === id) setSelectedAnnotationId(null);
    graph.set(
      ANNOTATIONS_CELL,
      graph.get<MultiGraphAnnotation[]>(ANNOTATIONS_CELL).filter((a) => a.id !== id),
    );
  }

  // "Jump to" a point/range annotation (Open MCT-inspired, per the research
  // roadmap): re-centers the shared viewport on the annotation, keeping its
  // current width/height -- v1 has no pan/zoom UI, so this is the one way
  // the viewport ever moves, but it's real: every curve visibly recenters,
  // since all rows already read VIEWPORT_CELL.
  function jumpToAnnotation(a: MultiGraphAnnotation) {
    if (zoomCommitTimerRef.current) {
      clearTimeout(zoomCommitTimerRef.current);
      zoomCommitTimerRef.current = null;
    }
    graph.set<Viewport | null>(LIVE_VIEWPORT_CELL, null);
    const current = graph.get<Viewport>(VIEWPORT_CELL);
    const halfWidth = (current.xMax - current.xMin) / 2;
    const halfHeight = (current.yMax - current.yMin) / 2;
    graph.set(VIEWPORT_CELL, {
      xMin: a.x - halfWidth,
      xMax: a.x + halfWidth,
      yMin: a.y - halfHeight,
      yMax: a.y + halfHeight,
    });
  }

  // Mirrors GraphCanvas's own writeUrl/subscribeAll pattern: keeps the URL
  // hash live-updated with the full row list + viewport, so reload restores
  // the session and "fork" (above) is just opening the current URL anew.
  useEffect(() => {
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeMultiGraphState(getCurrentMultiGraphState(graph))}`);
    }
    writeUrl();
    return graph.subscribeAll(writeUrl);
  }, [graph]);

  // Redraws whenever the row list changes, or any individual row's own
  // cells do -- graph.subscribeAll rather than per-row useCell hooks, since
  // the *set* of rows to draw changes as much as any one row's path/color/
  // visibility does, and a fixed hook-per-row list can't track a dynamic
  // row count anyway (React's rules of hooks require a static hook list).
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    function redraw() {
      if (!ctx) return;
      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      const viewport = graph.get<Viewport | null>(LIVE_VIEWPORT_CELL) ?? graph.get<Viewport>(VIEWPORT_CELL);
      const theme = getThemeColors();
      for (const id of graph.get<string[]>(EXPRESSION_LIST_CELL)) {
        const ids = cellIdsMultiRow(id);
        try {
          const path = graph.get<Path2D>(ids.path);
          const visible = graph.get<boolean>(ids.visible);
          drawExpressionLayer(ctx, path, visible, viewport, WIDTH, HEIGHT);
          if (visible) {
            const roots = graph.get<{ x: number; y: number }[]>(ids.roots);
            if (roots.length > 0) drawScatter(ctx, roots, viewport, WIDTH, HEIGHT, 4, theme.ink);
            const discontinuities = graph.get<{ before: { x: number; y: number }; after: { x: number; y: number } }[]>(
              ids.discontinuities,
            );
            if (discontinuities.length > 0) {
              drawOpenCircles(ctx, discontinuities.flatMap((g) => [g.before, g.after]), viewport, WIDTH, HEIGHT, 4);
            }
            const derivativePath = graph.get<Path2D | null>(ids.derivativePath);
            if (derivativePath) drawPath(ctx, derivativePath, viewport, WIDTH, HEIGHT, true);
          }
        } catch {
          // A row whose cells haven't been registered yet (ExpressionRow
          // hasn't mounted this render pass) -- skip it this frame, it'll
          // draw on the next redraw once mounted.
        }
      }
      const intersections = graph.get<{ x: number; y: number }[]>(INTERSECTIONS_CELL);
      if (intersections.length > 0) drawScatter(ctx, intersections, viewport, WIDTH, HEIGHT, 5, "#9333ea");
      for (const a of graph.get<MultiGraphAnnotation[]>(ANNOTATIONS_CELL)) {
        const selected = a.id === selectedAnnotationId;
        const sx = toScreenX(a.x, viewport, WIDTH);
        const sy = toScreenY(a.y, viewport, HEIGHT);
        ctx.save();
        ctx.fillStyle = selected ? "#dc2626" : "#b8752e";
        ctx.beginPath();
        ctx.arc(sx, sy, selected ? 6 : 4, 0, Math.PI * 2);
        ctx.fill();
        if (selected) {
          ctx.strokeStyle = "#dc2626";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(sx, sy, 10, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.font = selected ? "bold 12px sans-serif" : "12px sans-serif";
        ctx.fillStyle = selected ? "#dc2626" : theme.ink;
        ctx.fillText(a.label, sx + 8, sy - 8);
        ctx.restore();
      }
      const readout = graph.get<PointReadout | null>(POINT_READOUT_CELL);
      if (readout) {
        drawPoint(ctx, readout, viewport, WIDTH, HEIGHT, 6, `#${readout.color.toString(16).padStart(6, "0")}`);
      }
    }
    redraw();
    return graph.subscribeAll(redraw);
    // selectedAnnotationId isn't graph state, so it can't trigger a redraw via
    // subscribeAll -- re-running this effect (which calls redraw() once
    // immediately) on selection change is what keeps the highlight in sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, selectedAnnotationId]);

  return (
    <div>
      {rowIds.map((id) => (
        <ExpressionRow key={id} graph={graph} rowId={id} onRemove={rowIds.length > 1 ? () => removeRow(id) : undefined} />
      ))}
      <div style={{ margin: "0.5rem 0", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button type="button" onClick={addRow}>
          + Add expression
        </button>
        <button type="button" onClick={forkView} title="Open this exact view in a new tab to explore an alternate path">
          Fork this view
        </button>
        <button
          type="button"
          onClick={() => setAnnotating((a) => !a)}
          style={annotating ? { background: "#b8752e", color: "white" } : undefined}
        >
          {annotating ? "Click the canvas to place a note…" : "+ Annotate"}
        </button>
        <button
          type="button"
          onClick={() => {
            setReadoutMissed(false);
            setReadingPoint((r) => !r);
          }}
          style={readingPoint ? { background: "#0891b2", color: "white" } : undefined}
        >
          {readingPoint ? "Click a curve to read its value…" : "Read point"}
        </button>
        <button type="button" onClick={handleSave}>
          Save to gallery
        </button>
        <button type="button" onClick={resetView} title="Restore the default viewport">
          Reset view
        </button>
        <button type="button" onClick={history.undo} disabled={!history.canUndo} title="Undo (Ctrl+Z / Cmd+Z)">
          ↩ Undo
        </button>
        <button type="button" onClick={history.redo} disabled={!history.canRedo} title="Redo (Ctrl+Shift+Z / Cmd+Y)">
          ↪ Redo
        </button>
      </div>
      <p style={{ fontSize: "0.78rem", color: "var(--muted)", margin: "0.25rem 0" }}>
        Drag the canvas to pan, scroll to zoom.
      </p>
      {saveStatus && <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>{saveStatus}</p>}
      <div role="radiogroup" aria-label="Arithmetic mode" style={{ margin: "0.25rem 0" }}>
        <label>
          <input type="radio" name="multi-mode" checked={mode === "float"} onChange={() => graph.set(MODE_CELL, "float")} /> Float
        </label>{" "}
        <label>
          <input type="radio" name="multi-mode" checked={mode === "exact"} onChange={() => graph.set(MODE_CELL, "exact")} /> Exact
        </label>
      </div>
      <div>
        <canvas
          ref={canvasRef}
          width={WIDTH}
          height={HEIGHT}
          style={{
            border: "1px solid var(--border)",
            cursor: annotating || readingPoint ? "crosshair" : selectedAnnotationId ? "move" : "grab",
            touchAction: "none",
          }}
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handleCanvasPointerMove}
          onPointerUp={handleCanvasPointerUp}
          onPointerCancel={handleCanvasPointerUp}
          onWheel={handleCanvasWheel}
        />
      </div>
      {pointReadout &&
        (() => {
          const rowIds = cellIdsMultiRow(pointReadout.rowId);
          const source = graph.get<string>(rowIds.expr);
          // Exact-mode readout (issue #51, porting GraphCanvas's own mode):
          // re-evaluates the SELECTED row's own expression/params over
          // Rational arithmetic -- computed here on demand (only the one
          // row a click actually landed on needs it), not as a per-row
          // reactive cell every row would otherwise carry uselessly.
          const params = graph.hasValue(rowIds.params) ? graph.get<Record<string, number>>(rowIds.params) : {};
          const exact = mode === "exact" ? evaluateExactAt(source, pointReadout.x, params) : null;
          return (
            <p style={{ margin: "0.25rem 0" }}>
              <span style={{ color: `#${pointReadout.color.toString(16).padStart(6, "0")}` }}>●</span> {source}: f(
              {pointReadout.x.toFixed(4)}) = {mode === "exact" ? (exact ?? `${pointReadout.y.toFixed(4)} (not exact)`) : pointReadout.y.toFixed(4)}
            </p>
          );
        })()}
      {readoutMissed && !pointReadout && (
        <p style={{ margin: "0.25rem 0", color: "var(--muted)", fontSize: "0.85rem" }}>No curve close enough to that point.</p>
      )}
      <div style={{ margin: "0.25rem 0" }}>
        <PngExportButton getCanvas={() => canvasRef.current} label="multi-expression" />
      </div>
      {annotations.length > 0 && (
        <div style={{ margin: "0.5rem 0" }}>
          <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>Annotations</div>
          <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
            {annotations.map((a) => {
              const selected = a.id === selectedAnnotationId;
              return (
                <li key={a.id} style={{ margin: "0.15rem 0", background: selected ? "#fef2f2" : undefined }}>
                  {selected ? (
                    <input
                      // biome-ignore lint: autoFocus is intentional here -- selecting an annotation should let you rename it immediately
                      autoFocus
                      value={a.label}
                      onChange={(e) => updateAnnotationLabel(a.id, e.target.value)}
                      style={{ font: "inherit", fontWeight: 600, width: "14ch" }}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setSelectedAnnotationId(a.id)}
                      style={{ font: "inherit", fontWeight: 600, background: "none", border: "none", padding: 0, cursor: "pointer" }}
                      title="Select (then drag its marker on the canvas to move it, or edit its label here)"
                    >
                      {a.label}
                    </button>
                  )}{" "}
                  ({a.x.toFixed(2)}, {a.y.toFixed(2)}){" "}
                  <button type="button" onClick={() => jumpToAnnotation(a)}>
                    Jump
                  </button>{" "}
                  <button type="button" onClick={() => removeAnnotation(a.id)}>
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
          <p style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
            Click a marker or its label above to select it — drag a selected marker on the canvas to move it, or edit
            its label in the list.
          </p>
        </div>
      )}
    </div>
  );
}
