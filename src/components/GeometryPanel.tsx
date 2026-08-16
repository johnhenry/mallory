import { type PointerEvent, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlgebraView } from "./AlgebraView.tsx";
import { PngExportButton } from "./PngExportButton.tsx";
import { SvgExportButton } from "./SvgExportButton.tsx";
import { CellGraph } from "../lib/cell-graph.ts";
import { interiorAngleRadians, isSelfIntersecting, polygonCentroid, shoelaceArea } from "../lib/geometry.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useModelContextTool } from "../hooks/use-model-context-tool.ts";
import { useUndoHistory } from "../hooks/use-undo-history.ts";
import { COARSE_POINTER_HIT_RADIUS_MULTIPLIER, isCoarsePointer } from "../lib/pointer-media.ts";
import { canvasEventPoint, toDataX, toDataY, toScreenX, toScreenY, type Viewport } from "../lib/viewport.ts";
import { drawAxes } from "../lib/render-path.ts";
import { cellIdsGeometry, type CellIdsGeometry } from "../lib/cell-ids.ts";
import { layersToSvgDocument, type SvgLayer } from "../lib/svg-export.ts";
import { getThemeColors } from "../lib/theme-colors.ts";
import {
  DEFAULT_GEOMETRY_STATE,
  decodeGeometryState,
  encodeGeometryState,
  type GeometryOp,
  type GeometryState,
} from "../lib/geometry-state.ts";
import { saveGraph } from "../lib/saved-graphs.ts";

const WIDTH = 500;
const HEIGHT = 500;
const VIEWPORT: Viewport = { xMin: -5, xMax: 5, yMin: -5, yMax: 5 };
const HIT_RADIUS_PX = 14;
// Below this, a Line/Circle's defining points are close enough to be
// considered coincident -- a degenerate construction (zero length/radius)
// flagged in a warning color, the same declarative "condition read off the
// object's own dependent cell, decoupled from drawing" pattern
// findRootCrossings/findDiscontinuities use for curves. Deliberately much
// looser than an exact-zero check: a mouse/touch drag can realistically land
// within a few hundredths of a data unit of another point (at this
// viewport/canvas scale, ~2-3 screen pixels) but essentially never closer
// than 1e-6, so that threshold would never fire for a real user.
const DEGENERATE_EPSILON = 0.05;
const DEGENERATE_COLOR = "#d97706";

// Only the object-list and ops-log cells are namespaced per instance (via
// cellIdsGeometry(cellId), passed around as `listIds` below) -- every
// individual object cell (point/line/circle/...) is already keyed by its own
// crypto.randomUUID() object id, globally unique regardless of which
// construction created it, so it needs no further namespacing (same
// reasoning cellIdsNotebookBlock's rows -- via cellIdsMultiRow -- don't
// namespace by block either).
const pointCellId = (id: string) => `geomPoint:${id}`;
const lineCellId = (id: string) => `geomLine:${id}`;
const circleCellId = (id: string) => `geomCircle:${id}`;
const lengthCellId = (id: string) => `geomLength:${id}`;
const radiusCellId = (id: string) => `geomRadius:${id}`;
// Angle/polygon each split a *record* cell (which points define it) from a
// *dependent value* cell (the number itself), same as line/circle already
// split lineCellId/circleCellId from lengthCellId/radiusCellId.
const angleRecordCellId = (id: string) => `geomAngleRecord:${id}`;
const angleValueCellId = (id: string) => `geomAngleValue:${id}`;
const polygonCellId = (id: string) => `geomPolygon:${id}`;
const areaCellId = (id: string) => `geomArea:${id}`;
const polygonSelfIntersectingCellId = (id: string) => `geomSelfIntersecting:${id}`;

interface PointRecord {
  x: number;
  y: number;
}
interface LineRecord {
  a: string;
  b: string;
}
interface CircleRecord {
  center: string;
  radiusPoint: string;
}
interface AngleRecord {
  a: string;
  vertex: string;
  c: string;
}
interface PolygonRecord {
  points: string[];
}

type Tool = "point" | "line" | "circle" | "reflect" | "rotate" | "translate" | "scale" | "angle" | "polygon";

/**
 * v1 GeoGebra-style construction tools built directly on Wave 1's free/
 * dependent object model: a point is a free `PointRecord` cell created by
 * clicking with the Point tool; a Line/Circle is a free record naming which
 * two point ids it connects, plus a genuinely dependent companion cell (its
 * length/radius) that reads those points' current coordinates. Reflect/
 * Rotate/Translate go one step further: each produces a new *point* that is
 * itself a dependent cell (under the same `pointCellId` namespace a free
 * point uses, so it draws/selects identically and can feed further
 * construction), reading its source point(s) live -- dragging a free point
 * cascades through every line/circle/transform built from it, for free.
 */
/** Builds the full serializable state of one geometry construction -- shared by the URL-sync effect and the save-to-gallery handler. */
export function getCurrentGeometryState(graph: CellGraph, listIds: CellIdsGeometry): GeometryState {
  return { v: 1, ops: graph.has(listIds.opsLog) ? graph.get<GeometryOp[]>(listIds.opsLog) : [] };
}

/** Replays a construction log in order through the real add* functions, reconstructing every free AND dependent (reflect/rotate/translate/scale) point exactly as it was built interactively. */
export function replayGeometryOps(graph: CellGraph, listIds: CellIdsGeometry, ops: GeometryOp[]): void {
  for (const op of ops) {
    switch (op.tool) {
      case "point":
        addPoint(graph, listIds, op.x, op.y, op.id);
        break;
      case "line":
        addLine(graph, listIds, op.a, op.b, op.id);
        break;
      case "circle":
        addCircle(graph, listIds, op.center, op.radiusPoint, op.id);
        break;
      case "reflection":
        addReflection(graph, listIds, op.source, op.center, op.id);
        break;
      case "rotation":
        addRotation(graph, listIds, op.source, op.center, op.angleDegrees, op.id);
        break;
      case "translation":
        addTranslation(graph, listIds, op.source, op.dx, op.dy, op.id);
        break;
      case "scale":
        addScale(graph, listIds, op.source, op.center, op.factor, op.id);
        break;
      case "angle":
        addAngle(graph, listIds, op.a, op.vertex, op.c, op.id);
        break;
      case "polygon":
        addPolygon(graph, listIds, op.points, op.id);
        break;
    }
  }
}

/**
 * Deletes every object cell (and its dependent companion, if any) tracked in
 * `objectList`, then resets `objectList`/`opsLog` to empty -- the "undo the
 * whole construction back to nothing" counterpart `replayGeometryOps` needs,
 * since that function's `add*` calls assume a blank graph (redefining an
 * id that's still live would be a real `graph.define`/`graph.set` conflict,
 * not a harmless overwrite the way a flat free-cell panel's re-`set` is).
 * `CellGraph.delete` no-ops on an id that was never set, so calling every
 * cell-id helper for every object (most of which don't apply to that
 * object's tool type) is safe rather than needing a per-type dispatch.
 */
function clearGeometryState(graph: CellGraph, listIds: CellIdsGeometry): void {
  for (const id of graph.get<string[]>(listIds.objectList)) {
    graph.delete(pointCellId(id));
    graph.delete(lineCellId(id));
    graph.delete(circleCellId(id));
    graph.delete(lengthCellId(id));
    graph.delete(radiusCellId(id));
    graph.delete(angleRecordCellId(id));
    graph.delete(angleValueCellId(id));
    graph.delete(polygonCellId(id));
    graph.delete(areaCellId(id));
    graph.delete(polygonSelfIntersectingCellId(id));
  }
  graph.set(listIds.objectList, [] as string[], { auxiliary: true });
  graph.set(listIds.opsLog, [] as GeometryOp[], { auxiliary: true });
}

/** `useUndoHistory`'s `applyState`: reset to blank, then replay the target snapshot's ops in order (issue #43's geometry adoption). */
export function applyGeometryState(graph: CellGraph, listIds: CellIdsGeometry, state: GeometryState): void {
  clearGeometryState(graph, listIds);
  replayGeometryOps(graph, listIds, state.ops);
}

/**
 * Shares an `externalGraph` when supplied (e.g. a notebook block) instead of
 * creating a private one, mirroring Graph3DCanvas's `useExpressionGraph3D`.
 * URL-hash hydration (replaying a saved construction log) only applies to
 * the standalone, private-graph case, since an external graph's owner
 * (NotebookPanel) is responsible for its own seeding.
 */
function useGeometryGraph(listIds: CellIdsGeometry, externalGraph?: CellGraph): CellGraph {
  const ref = useRef<CellGraph | null>(null);
  if (!ref.current) {
    const graph = externalGraph ?? new CellGraph();
    if (!graph.has(listIds.objectList)) {
      graph.set(listIds.objectList, [] as string[], { auxiliary: true });
      graph.set(listIds.opsLog, [] as GeometryOp[], { auxiliary: true });
      const decoded = !externalGraph && typeof window !== "undefined" ? decodeGeometryState(window.location.hash.slice(1)) : null;
      if (decoded) replayGeometryOps(graph, listIds, decoded.ops);
    }
    ref.current = graph;
  }
  return ref.current;
}

function pushObject(graph: CellGraph, listIds: CellIdsGeometry, id: string): void {
  graph.set(listIds.objectList, [...graph.get<string[]>(listIds.objectList), id], { auxiliary: true });
}

function pushOp(graph: CellGraph, listIds: CellIdsGeometry, op: GeometryOp): void {
  graph.set(listIds.opsLog, [...graph.get<GeometryOp[]>(listIds.opsLog), op], { auxiliary: true });
}

/** Converts HIT_RADIUS_PX to a data-space radius, widened on a coarse pointer (issue #53's "roll out" item) -- a touch tap on a construction point is a much less precise target than a mouse click, same isCoarsePointer() treatment GraphCanvasMulti's own hit-testing already uses. */
function currentHitDataRadius(): number {
  const px = isCoarsePointer() ? HIT_RADIUS_PX * COARSE_POINTER_HIT_RADIUS_MULTIPLIER : HIT_RADIUS_PX;
  return (px / WIDTH) * (VIEWPORT.xMax - VIEWPORT.xMin);
}

/** Nearest point within `maxDistance`, optionally restricted to free (draggable) points -- a dependent/transformed point is still a valid line/circle/transform endpoint, just not draggable itself. */
function nearestPointId(graph: CellGraph, listIds: CellIdsGeometry, x: number, y: number, maxDistance: number, freeOnly = false): string | null {
  let best: string | null = null;
  let bestDist = maxDistance;
  for (const id of graph.get<string[]>(listIds.objectList)) {
    if (!graph.has(pointCellId(id))) continue;
    if (freeOnly && graph.role(pointCellId(id)) !== "free") continue;
    const p = graph.get<PointRecord>(pointCellId(id));
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestDist) {
      bestDist = d;
      best = id;
    }
  }
  return best;
}

function addPoint(graph: CellGraph, listIds: CellIdsGeometry, x: number, y: number, id: string = crypto.randomUUID()): string {
  graph.set(pointCellId(id), { x, y });
  pushObject(graph, listIds, id);
  pushOp(graph, listIds, { tool: "point", id, x, y });
  return id;
}

function addLine(graph: CellGraph, listIds: CellIdsGeometry, a: string, b: string, id: string = crypto.randomUUID()): void {
  graph.set(lineCellId(id), { a, b });
  graph.define(lengthCellId(id), () => {
    const pa = graph.get<PointRecord>(pointCellId(a));
    const pb = graph.get<PointRecord>(pointCellId(b));
    return Math.hypot(pa.x - pb.x, pa.y - pb.y);
  });
  pushObject(graph, listIds, id);
  pushOp(graph, listIds, { tool: "line", id, a, b });
}

function addCircle(graph: CellGraph, listIds: CellIdsGeometry, center: string, radiusPoint: string, id: string = crypto.randomUUID()): void {
  graph.set(circleCellId(id), { center, radiusPoint });
  graph.define(radiusCellId(id), () => {
    const pc = graph.get<PointRecord>(pointCellId(center));
    const pr = graph.get<PointRecord>(pointCellId(radiusPoint));
    return Math.hypot(pc.x - pr.x, pc.y - pr.y);
  });
  pushObject(graph, listIds, id);
  pushOp(graph, listIds, { tool: "circle", id, center, radiusPoint });
}

/** Point reflection: the new point is as far past `center` as `source` is before it. */
function addReflection(graph: CellGraph, listIds: CellIdsGeometry, source: string, center: string, id: string = crypto.randomUUID()): void {
  graph.define(pointCellId(id), (): PointRecord => {
    const s = graph.get<PointRecord>(pointCellId(source));
    const c = graph.get<PointRecord>(pointCellId(center));
    return { x: 2 * c.x - s.x, y: 2 * c.y - s.y };
  });
  pushObject(graph, listIds, id);
  pushOp(graph, listIds, { tool: "reflection", id, source, center });
}

/** Rotates `source` around `center` by a fixed angle, captured at construction time (the source/center dependency stays live; the angle itself does not). */
function addRotation(
  graph: CellGraph,
  listIds: CellIdsGeometry,
  source: string,
  center: string,
  angleDegrees: number,
  id: string = crypto.randomUUID(),
): void {
  const theta = (angleDegrees * Math.PI) / 180;
  graph.define(pointCellId(id), (): PointRecord => {
    const s = graph.get<PointRecord>(pointCellId(source));
    const c = graph.get<PointRecord>(pointCellId(center));
    const dx = s.x - c.x;
    const dy = s.y - c.y;
    return {
      x: c.x + dx * Math.cos(theta) - dy * Math.sin(theta),
      y: c.y + dx * Math.sin(theta) + dy * Math.cos(theta),
    };
  });
  pushObject(graph, listIds, id);
  pushOp(graph, listIds, { tool: "rotation", id, source, center, angleDegrees });
}

/** Translates `source` by a fixed (dx, dy), captured at construction time -- the source dependency stays live. */
function addTranslation(
  graph: CellGraph,
  listIds: CellIdsGeometry,
  source: string,
  dx: number,
  dy: number,
  id: string = crypto.randomUUID(),
): void {
  graph.define(pointCellId(id), (): PointRecord => {
    const s = graph.get<PointRecord>(pointCellId(source));
    return { x: s.x + dx, y: s.y + dy };
  });
  pushObject(graph, listIds, id);
  pushOp(graph, listIds, { tool: "translation", id, source, dx, dy });
}

/** Scales `source` about `center` by a fixed factor, captured at construction time -- the source/center dependency stays live. */
function addScale(
  graph: CellGraph,
  listIds: CellIdsGeometry,
  source: string,
  center: string,
  factor: number,
  id: string = crypto.randomUUID(),
): void {
  graph.define(pointCellId(id), (): PointRecord => {
    const s = graph.get<PointRecord>(pointCellId(source));
    const c = graph.get<PointRecord>(pointCellId(center));
    return { x: c.x + factor * (s.x - c.x), y: c.y + factor * (s.y - c.y) };
  });
  pushObject(graph, listIds, id);
  pushOp(graph, listIds, { tool: "scale", id, source, center, factor });
}

/** Interior angle ABC at `vertex`, reading all three points live -- same record/dependent-value split as Line/Circle. */
function addAngle(graph: CellGraph, listIds: CellIdsGeometry, a: string, vertex: string, c: string, id: string = crypto.randomUUID()): void {
  graph.set(angleRecordCellId(id), { a, vertex, c } as AngleRecord);
  graph.define(angleValueCellId(id), (): number => {
    const pa = graph.get<PointRecord>(pointCellId(a));
    const pv = graph.get<PointRecord>(pointCellId(vertex));
    const pc = graph.get<PointRecord>(pointCellId(c));
    return interiorAngleRadians(pa, pv, pc);
  });
  pushObject(graph, listIds, id);
  pushOp(graph, listIds, { tool: "angle", id, a, vertex, c });
}

/**
 * An ordered vertex loop, closed by re-clicking the first vertex -- area
 * via the shoelace formula, reading every point live. The
 * self-intersection flag is its own dependent cell (the same declarative
 * "condition read off a dependent cell, decoupled from drawing" pattern
 * the degenerate line/circle flags use), so it recomputes live as
 * vertices drag and shows up in the Objects list alongside the area.
 * Note the shoelace number is only a meaningful "area" when this flag is
 * false -- the flag is the caveat, per this panel's flag-don't-block
 * convention (a degenerate line isn't prevented either, just recolored).
 */
function addPolygon(graph: CellGraph, listIds: CellIdsGeometry, points: string[], id: string = crypto.randomUUID()): void {
  graph.set(polygonCellId(id), { points } as PolygonRecord);
  graph.define(areaCellId(id), (): number => {
    const pts = points.map((pid) => graph.get<PointRecord>(pointCellId(pid)));
    return shoelaceArea(pts);
  });
  graph.define(polygonSelfIntersectingCellId(id), (): boolean => {
    const pts = points.map((pid) => graph.get<PointRecord>(pointCellId(pid)));
    return isSelfIntersecting(pts);
  });
  pushObject(graph, listIds, id);
  pushOp(graph, listIds, { tool: "polygon", id, points });
}

export interface GeometryPanelProps {
  /** Share an existing CellGraph (e.g. from a notebook block) instead of creating a private one. */
  graph?: CellGraph;
  /** Hydrate from and write to the URL fragment. Off for a notebook-embedded instance, whose document owns persistence instead. */
  syncUrl?: boolean;
  /** Namespaces this construction's object-list/ops-log cells and WebMCP tool names (e.g. a notebook block's own id), so more than one construction can share a CellGraph. Defaults to a stable single-instance value for the standalone page. */
  cellId?: string;
}

export function GeometryPanel({ graph: externalGraph, syncUrl = true, cellId = "geo-1" }: GeometryPanelProps = {}) {
  const listIds = cellIdsGeometry(cellId);
  const graph = useGeometryGraph(listIds, externalGraph);
  const toolPrefix = `geometry_${cellId}`;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [tool, setTool] = useState<Tool>("point");
  const [pending, setPending] = useState<string | null>(null);
  // Angle needs a 3-click sequence and Polygon an unbounded one -- neither
  // fits the single `pending: string | null` selection every other tool
  // (line/circle/reflect/rotate/scale/translate) shares, so each gets its
  // own accumulator, reset alongside `pending` on every tool/construction change.
  const [pendingAngle, setPendingAngle] = useState<string[]>([]);
  const [pendingPolygon, setPendingPolygon] = useState<string[]>([]);
  const [angleInput, setAngleInput] = useState("90");
  const [dxInput, setDxInput] = useState("1");
  const [dyInput, setDyInput] = useState("0");
  const [factorInput, setFactorInput] = useState("2");
  const dragRef = useRef<{ id: string; moved: boolean } | null>(null);

  useCellGraphTools(toolPrefix, graph);

  // Standalone only (issue #43, same enabled:syncUrl pattern as the other
  // panel adoptions): a notebook-embedded instance shares its graph with
  // NotebookPanel's own useUndoHistory, so a second independent history
  // here would double-fire on Ctrl+Z. applyState also resets any
  // in-progress multi-click selection (pending/pendingAngle/pendingPolygon)
  // -- those hold point ids that may not exist in the restored snapshot,
  // so completing an in-progress construction across an undo/redo would
  // reference a stale or now-nonexistent point.
  const history = useUndoHistory(
    graph,
    () => getCurrentGeometryState(graph, listIds),
    (state) => {
      applyGeometryState(graph, listIds, state);
      setPending(null);
      setPendingAngle([]);
      setPendingPolygon([]);
    },
    250,
    undefined,
    syncUrl,
  );

  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const saveGraphFn = useServerFn(saveGraph);

  async function handleSave() {
    const title = window.prompt("Title for this saved construction:", "Untitled");
    if (title === null) return;
    setSaveStatus("Saving…");
    try {
      await saveGraphFn({ data: { title, kind: "geometry", state: getCurrentGeometryState(graph, listIds) } });
      setSaveStatus(`Saved as "${title || "Untitled"}" — see the gallery to reopen it.`);
    } catch (e) {
      setSaveStatus(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Keep the URL fragment in sync with the live construction log, mirroring OdePanel's pattern.
  useEffect(() => {
    if (!syncUrl) return;
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeGeometryState(getCurrentGeometryState(graph, listIds))}`);
    }
    writeUrl();
    return graph.subscribeAll(writeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, syncUrl]);

  // One WebMCP tool per construction, each a thin wrapper over the function
  // above -- these already take data coordinates/point ids directly (not
  // pixel positions or pointer events), so there's no new logic here, just
  // registration (mallory-graph's WebMCP pass). Every add* function returns
  // (or, for the void ones, is immediately followed by reading) the new
  // object's id, so an agent can chain calls: add two points, then a line
  // between the returned ids.
  useModelContextTool({
    name: `${toolPrefix}_add_point`,
    description: "Add a free point at (x, y). Returns the new point's id, for use as `a`/`b`/`source`/`center`/etc. in later geometry_add_* calls.",
    inputSchema: {
      type: "object",
      properties: { x: { type: "number" }, y: { type: "number" } },
      required: ["x", "y"],
    },
    handler: (input: Record<string, unknown>) => ({ id: addPoint(graph, listIds, Number(input.x), Number(input.y)) }),
  });

  useModelContextTool({
    name: `${toolPrefix}_add_line`,
    description: "Add a line through two existing points (by id, as returned from geometry_add_point or geomObjects).",
    inputSchema: {
      type: "object",
      properties: { a: { type: "string" }, b: { type: "string" } },
      required: ["a", "b"],
    },
    handler: (input: Record<string, unknown>) => {
      addLine(graph, listIds, String(input.a), String(input.b));
      return { ok: true };
    },
  });

  useModelContextTool({
    name: `${toolPrefix}_add_circle`,
    description: "Add a circle centered at one existing point, passing through another (both by id).",
    inputSchema: {
      type: "object",
      properties: { center: { type: "string" }, radiusPoint: { type: "string" } },
      required: ["center", "radiusPoint"],
    },
    handler: (input: Record<string, unknown>) => {
      addCircle(graph, listIds, String(input.center), String(input.radiusPoint));
      return { ok: true };
    },
  });

  useModelContextTool({
    name: `${toolPrefix}_add_reflection`,
    description: "Add a point reflection of `source` through `center` (both existing point ids).",
    inputSchema: {
      type: "object",
      properties: { source: { type: "string" }, center: { type: "string" } },
      required: ["source", "center"],
    },
    handler: (input: Record<string, unknown>) => {
      addReflection(graph, listIds, String(input.source), String(input.center));
      return { ok: true };
    },
  });

  useModelContextTool({
    name: `${toolPrefix}_add_rotation`,
    description: "Rotate `source` around `center` by a fixed angle in degrees (both existing point ids).",
    inputSchema: {
      type: "object",
      properties: { source: { type: "string" }, center: { type: "string" }, angleDegrees: { type: "number" } },
      required: ["source", "center", "angleDegrees"],
    },
    handler: (input: Record<string, unknown>) => {
      addRotation(graph, listIds, String(input.source), String(input.center), Number(input.angleDegrees));
      return { ok: true };
    },
  });

  useModelContextTool({
    name: `${toolPrefix}_add_translation`,
    description: "Translate `source` by a fixed (dx, dy) (source is an existing point id).",
    inputSchema: {
      type: "object",
      properties: { source: { type: "string" }, dx: { type: "number" }, dy: { type: "number" } },
      required: ["source", "dx", "dy"],
    },
    handler: (input: Record<string, unknown>) => {
      addTranslation(graph, listIds, String(input.source), Number(input.dx), Number(input.dy));
      return { ok: true };
    },
  });

  useModelContextTool({
    name: `${toolPrefix}_add_scale`,
    description: "Scale `source` about `center` by a fixed factor (both existing point ids).",
    inputSchema: {
      type: "object",
      properties: { source: { type: "string" }, center: { type: "string" }, factor: { type: "number" } },
      required: ["source", "center", "factor"],
    },
    handler: (input: Record<string, unknown>) => {
      addScale(graph, listIds, String(input.source), String(input.center), Number(input.factor));
      return { ok: true };
    },
  });

  useModelContextTool({
    name: `${toolPrefix}_add_angle`,
    description: "Measure the interior angle at `vertex` between rays to `a` and `c` (all existing point ids).",
    inputSchema: {
      type: "object",
      properties: { a: { type: "string" }, vertex: { type: "string" }, c: { type: "string" } },
      required: ["a", "vertex", "c"],
    },
    handler: (input: Record<string, unknown>) => {
      addAngle(graph, listIds, String(input.a), String(input.vertex), String(input.c));
      return { ok: true };
    },
  });

  useModelContextTool({
    name: `${toolPrefix}_add_polygon`,
    description: "Add a polygon through an ordered list of existing point ids (closed automatically back to the first).",
    inputSchema: {
      type: "object",
      properties: { points: { type: "array", items: { type: "string" }, description: "Ordered point ids, at least 3." } },
      required: ["points"],
    },
    handler: (input: Record<string, unknown>) => {
      const points = input.points;
      if (!Array.isArray(points) || points.length < 3) throw new Error("points must be an array of at least 3 point ids.");
      addPolygon(graph, listIds, points.map(String));
      return { ok: true };
    },
  });

  function dataCoordsFromEvent(e: PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const { sx, sy } = canvasEventPoint(e, e.currentTarget, WIDTH, HEIGHT);
    return { x: toDataX(sx, VIEWPORT, WIDTH), y: toDataY(sy, VIEWPORT, HEIGHT) };
  }

  /** A plain (no-drag) click landing on an existing point -- free or dependent. */
  function handlePointClick(hitId: string) {
    if (tool === "point") return; // clicking an existing point with the Point tool is a no-op; drag it instead
    if (tool === "translate") {
      addTranslation(graph, listIds, hitId, Number(dxInput) || 0, Number(dyInput) || 0);
      return;
    }
    if (tool === "angle") {
      const next = [...pendingAngle, hitId];
      if (next.length < 3) {
        setPendingAngle(next);
      } else {
        addAngle(graph, listIds, next[0] as string, next[1] as string, next[2] as string);
        setPendingAngle([]);
      }
      return;
    }
    if (tool === "polygon") {
      if (pendingPolygon.length >= 3 && hitId === pendingPolygon[0]) {
        addPolygon(graph, listIds, pendingPolygon);
        setPendingPolygon([]);
        return;
      }
      if (pendingPolygon.includes(hitId) && hitId !== pendingPolygon[0]) return; // ignore re-clicking a non-closing vertex already in the loop
      setPendingPolygon([...pendingPolygon, hitId]);
      return;
    }
    if (!pending) {
      setPending(hitId);
      return;
    }
    if (pending === hitId) {
      setPending(null); // clicked the same point twice -- cancel the pending selection
      return;
    }
    if (tool === "line") addLine(graph, listIds, pending, hitId);
    else if (tool === "circle") addCircle(graph, listIds, pending, hitId);
    else if (tool === "reflect") addReflection(graph, listIds, pending, hitId);
    else if (tool === "rotate") addRotation(graph, listIds, pending, hitId, Number(angleInput) || 90);
    else if (tool === "scale") addScale(graph, listIds, pending, hitId, Number(factorInput) || 2);
    setPending(null);
  }

  function handleEmptyClick(x: number, y: number) {
    if (tool === "point") addPoint(graph, listIds, x, y);
    // every other tool only connects existing points -- clicking empty space is a no-op
  }

  function handlePointerDown(e: PointerEvent<HTMLCanvasElement>) {
    const { x, y } = dataCoordsFromEvent(e);
    const freeHit = nearestPointId(graph, listIds, x, y, currentHitDataRadius(), true);
    if (freeHit) {
      dragRef.current = { id: freeHit, moved: false };
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  }

  function handlePointerMove(e: PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    drag.moved = true;
    const { x, y } = dataCoordsFromEvent(e);
    graph.set(pointCellId(drag.id), { x, y });
  }

  function handlePointerUp(e: PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      if (!drag.moved) handlePointClick(drag.id);
      return;
    }
    const { x, y } = dataCoordsFromEvent(e);
    const hit = nearestPointId(graph, listIds, x, y, currentHitDataRadius());
    if (hit) handlePointClick(hit);
    else handleEmptyClick(x, y);
  }

  // graph.subscribeAll (not the OBJECT_LIST_CELL/pending values as a
  // dependency array) is what makes a dragged point's dependents (lines,
  // circles, reflect/rotate/translate results) visibly redraw -- the one
  // real gap this panel had: every cell already recomputed correctly on a
  // drag, but nothing had told the canvas to repaint. Matches
  // GraphCanvasMulti's identical redraw pattern.
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    function redraw() {
      if (!ctx) return;
      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      drawAxes(ctx, VIEWPORT, WIDTH, HEIGHT);
      for (const id of graph.get<string[]>(listIds.objectList)) {
        if (graph.has(pointCellId(id))) {
          const p = graph.get<PointRecord>(pointCellId(id));
          const isFree = graph.role(pointCellId(id)) === "free";
          const isPendingSelection = id === pending || pendingAngle.includes(id) || pendingPolygon.includes(id);
          const color = isPendingSelection ? "#dc2626" : isFree ? "#2563eb" : "var(--muted)";
          drawDot(ctx, p.x, p.y, color);
        } else if (graph.has(lineCellId(id))) {
          const { a, b } = graph.get<LineRecord>(lineCellId(id));
          const pa = graph.get<PointRecord>(pointCellId(a));
          const pb = graph.get<PointRecord>(pointCellId(b));
          // Reads (not just draws) the dependent length cell -- a lazily-
          // defined cell only reports hasValue:true, and so only appears in
          // AlgebraView's Objects list, once something actually calls
          // get() on it. Nothing else ever did.
          const length = graph.get<number>(lengthCellId(id));
          drawLine(ctx, pa, pb, length < DEGENERATE_EPSILON);
        } else if (graph.has(circleCellId(id))) {
          const { center, radiusPoint } = graph.get<CircleRecord>(circleCellId(id));
          const pc = graph.get<PointRecord>(pointCellId(center));
          // Same reasoning as the line's length above -- reuse the
          // dependent radius cell's own value instead of recomputing it
          // inline, which also makes it appear in the Objects list.
          const radius = graph.get<number>(radiusCellId(id));
          drawCircle(ctx, pc, radius, radius < DEGENERATE_EPSILON);
        } else if (graph.has(angleRecordCellId(id))) {
          const { a, vertex, c } = graph.get<AngleRecord>(angleRecordCellId(id));
          const pa = graph.get<PointRecord>(pointCellId(a));
          const pv = graph.get<PointRecord>(pointCellId(vertex));
          const pc = graph.get<PointRecord>(pointCellId(c));
          // Reads the dependent angle value the same reuse-it-for-drawing
          // pattern length/radius already establish (also populates hasValue
          // for AlgebraView's Objects list).
          const angle = graph.get<number>(angleValueCellId(id));
          drawAngle(ctx, pa, pv, pc, angle);
        } else if (graph.has(polygonCellId(id))) {
          const { points } = graph.get<PolygonRecord>(polygonCellId(id));
          const pts = points.map((pid) => graph.get<PointRecord>(pointCellId(pid)));
          // Same reasoning as length/radius/angle above.
          const area = graph.get<number>(areaCellId(id));
          const selfIntersecting = graph.get<boolean>(polygonSelfIntersectingCellId(id));
          drawPolygon(ctx, pts, area, selfIntersecting);
        }
      }
    }
    redraw();
    return graph.subscribeAll(redraw);
    // `pending`/`pendingAngle`/`pendingPolygon` aren't graph state, so they
    // can't trigger a redraw via subscribeAll -- re-running this effect
    // (which calls redraw() once immediately) on selection change is what
    // keeps the highlight in sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, pending, pendingAngle, pendingPolygon]);

  /**
   * Builds the exported SVG's layer list -- a `layersToSvgDocument`-ready
   * mirror of `redraw()`'s own object-list loop above, covering all 5
   * object types (points, lines, circles, angles, polygons), including
   * the ephemeral pending-selection highlighting, so the exported SVG
   * matches the on-screen canvas exactly rather than only the "settled"
   * construction. `"scatter"` takes one color per layer (not per-point),
   * so points are bucketed by their current highlight state into up to 3
   * layers instead of drawn inline per-object like the canvas does; those
   * 3 layers are appended after every line/circle/angle/polygon layer,
   * so points always render on top regardless of construction order --
   * a deliberate, minor divergence from the canvas's strict object-list
   * z-order (where a later line can occlude an earlier point), traded for
   * not needing a `"scatter"` layer per point.
   */
  function geometryExportLayers(): SvgLayer[] {
    const layers: SvgLayer[] = [];
    const pendingPoints: { x: number; y: number }[] = [];
    const freePoints: { x: number; y: number }[] = [];
    const dependentPoints: { x: number; y: number }[] = [];

    for (const id of graph.get<string[]>(listIds.objectList)) {
      if (graph.has(pointCellId(id))) {
        const p = graph.get<PointRecord>(pointCellId(id));
        const isFree = graph.role(pointCellId(id)) === "free";
        const isPendingSelection = id === pending || pendingAngle.includes(id) || pendingPolygon.includes(id);
        (isPendingSelection ? pendingPoints : isFree ? freePoints : dependentPoints).push({ x: p.x, y: p.y });
      } else if (graph.has(lineCellId(id))) {
        const { a, b } = graph.get<LineRecord>(lineCellId(id));
        const pa = graph.get<PointRecord>(pointCellId(a));
        const pb = graph.get<PointRecord>(pointCellId(b));
        const length = graph.get<number>(lengthCellId(id));
        layers.push({ kind: "polyline", points: [pa, pb], color: length < DEGENERATE_EPSILON ? DEGENERATE_COLOR : "#142033", strokeWidth: 2 });
      } else if (graph.has(circleCellId(id))) {
        const { center, radiusPoint } = graph.get<CircleRecord>(circleCellId(id));
        const pc = graph.get<PointRecord>(pointCellId(center));
        const radius = graph.get<number>(radiusCellId(id));
        layers.push({ kind: "circle", cx: pc.x, cy: pc.y, radius, color: radius < DEGENERATE_EPSILON ? DEGENERATE_COLOR : "#16a34a", strokeWidth: 2 });
      } else if (graph.has(angleRecordCellId(id))) {
        const { a, vertex, c } = graph.get<AngleRecord>(angleRecordCellId(id));
        const pa = graph.get<PointRecord>(pointCellId(a));
        const pv = graph.get<PointRecord>(pointCellId(vertex));
        const pc = graph.get<PointRecord>(pointCellId(c));
        const angle = graph.get<number>(angleValueCellId(id));
        layers.push(...angleExportLayers(pa, pv, pc, angle));
      } else if (graph.has(polygonCellId(id))) {
        const { points } = graph.get<PolygonRecord>(polygonCellId(id));
        const pts = points.map((pid) => graph.get<PointRecord>(pointCellId(pid)));
        const area = graph.get<number>(areaCellId(id));
        const selfIntersecting = graph.get<boolean>(polygonSelfIntersectingCellId(id));
        layers.push(...polygonExportLayers(pts, area, selfIntersecting));
      }
    }

    if (dependentPoints.length > 0) layers.push({ kind: "scatter", points: dependentPoints, color: getThemeColors().muted });
    if (freePoints.length > 0) layers.push({ kind: "scatter", points: freePoints, color: "#2563eb" });
    if (pendingPoints.length > 0) layers.push({ kind: "scatter", points: pendingPoints, color: "#dc2626" });

    return layers;
  }

  const hint =
    tool === "point"
      ? "Click empty space to place a point, or drag an existing one."
      : tool === "translate"
        ? "Click a point to translate it by (dx, dy)."
        : tool === "angle"
          ? pendingAngle.length === 0
            ? "Click a point, then the vertex, then the other point."
            : pendingAngle.length === 1
              ? "Click the vertex point."
              : "Click the other point."
          : tool === "polygon"
            ? pendingPolygon.length === 0
              ? "Click each vertex in order; click the first vertex again to close the polygon."
              : `Click the next vertex, or click the first vertex again to close (${pendingPolygon.length} so far).`
            : pending
              ? `Click the ${tool === "line" ? "second" : tool === "circle" ? "radius" : "reference"} point (highlighted point selected).`
              : `Click a point to start a ${tool}.`;

  return (
    <div>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        {(["point", "line", "circle", "reflect", "rotate", "translate", "scale", "angle", "polygon"] as const).map((t) => (
          <label key={t}>
            <input
              type="radio"
              checked={tool === t}
              onChange={() => {
                setTool(t);
                setPending(null);
                setPendingAngle([]);
                setPendingPolygon([]);
              }}
            />{" "}
            {t}
          </label>
        ))}
        {tool === "rotate" && (
          <label>
            angle (°):{" "}
            <input value={angleInput} onChange={(e) => setAngleInput(e.target.value)} style={{ font: "inherit", width: "5ch" }} />
          </label>
        )}
        {tool === "scale" && (
          <label>
            factor:{" "}
            <input value={factorInput} onChange={(e) => setFactorInput(e.target.value)} style={{ font: "inherit", width: "5ch" }} />
          </label>
        )}
        {tool === "translate" && (
          <>
            <label>
              dx: <input value={dxInput} onChange={(e) => setDxInput(e.target.value)} style={{ font: "inherit", width: "5ch" }} />
            </label>
            <label>
              dy: <input value={dyInput} onChange={(e) => setDyInput(e.target.value)} style={{ font: "inherit", width: "5ch" }} />
            </label>
          </>
        )}
      </div>
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        style={{ border: "1px solid var(--border)", cursor: "crosshair", touchAction: "none" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
      <div style={{ margin: "0.25rem 0" }}>
        <PngExportButton getCanvas={() => canvasRef.current} label="geometry" />
        <SvgExportButton
          getSvg={() => {
            const layers = geometryExportLayers();
            return layers.length > 0 ? layersToSvgDocument(layers, VIEWPORT, WIDTH, HEIGHT) : null;
          }}
          label="geometry"
        />
      </div>
      <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>{hint}</p>
      <div style={{ margin: "0.5rem 0" }}>
        <AlgebraView graph={graph} />
      </div>
      {syncUrl && (
        <div style={{ margin: "0.5rem 0" }}>
          <button type="button" onClick={handleSave}>
            Save to gallery
          </button>{" "}
          <button type="button" onClick={history.undo} disabled={!history.canUndo} title="Undo (Ctrl+Z / Cmd+Z)">
            ↩ Undo
          </button>{" "}
          <button type="button" onClick={history.redo} disabled={!history.canRedo} title="Redo (Ctrl+Shift+Z / Cmd+Y)">
            ↪ Redo
          </button>
          {saveStatus && <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>{saveStatus}</p>}
        </div>
      )}
    </div>
  );
}

function drawDot(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  const sx = toScreenX(x, VIEWPORT, WIDTH);
  const sy = toScreenY(y, VIEWPORT, HEIGHT);
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(sx, sy, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawLine(ctx: CanvasRenderingContext2D, a: PointRecord, b: PointRecord, degenerate = false): void {
  ctx.save();
  ctx.strokeStyle = degenerate ? DEGENERATE_COLOR : "#142033";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(toScreenX(a.x, VIEWPORT, WIDTH), toScreenY(a.y, VIEWPORT, HEIGHT));
  ctx.lineTo(toScreenX(b.x, VIEWPORT, WIDTH), toScreenY(b.y, VIEWPORT, HEIGHT));
  ctx.stroke();
  ctx.restore();
}

function drawCircle(ctx: CanvasRenderingContext2D, center: PointRecord, radius: number, degenerate = false): void {
  const sx = toScreenX(center.x, VIEWPORT, WIDTH);
  const sy = toScreenY(center.y, VIEWPORT, HEIGHT);
  const screenRadius = (radius / (VIEWPORT.xMax - VIEWPORT.xMin)) * WIDTH;
  ctx.save();
  ctx.strokeStyle = degenerate ? DEGENERATE_COLOR : "#16a34a";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(sx, sy, screenRadius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * A small fixed-radius arc at `vertex` sweeping through the interior (non-
 * reflex) angle between rays to `a`/`c`, plus a degree-label near its
 * midpoint. Canvas angles increase in the visually-clockwise direction
 * (screen y grows downward), so the two ray angles are computed directly
 * in screen space rather than converted from data space -- arc-drawing is
 * inherently a screen-space operation. The signed, wrapped difference
 * `diff` (always in (-PI, PI]) both picks the sweep direction (anticlockwise
 * when negative) and locates the arc's angular midpoint for the label,
 * matching interiorAngleRadians' own "always the <=180 degree angle"
 * convention.
 */
function drawAngle(ctx: CanvasRenderingContext2D, a: PointRecord, vertex: PointRecord, c: PointRecord, angleRadians: number): void {
  const vx = toScreenX(vertex.x, VIEWPORT, WIDTH);
  const vy = toScreenY(vertex.y, VIEWPORT, HEIGHT);
  const ax = toScreenX(a.x, VIEWPORT, WIDTH);
  const ay = toScreenY(a.y, VIEWPORT, HEIGHT);
  const cx = toScreenX(c.x, VIEWPORT, WIDTH);
  const cy = toScreenY(c.y, VIEWPORT, HEIGHT);
  const theta1 = Math.atan2(ay - vy, ax - vx);
  const theta2 = Math.atan2(cy - vy, cx - vx);
  let diff = theta2 - theta1;
  while (diff <= -Math.PI) diff += 2 * Math.PI;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  const anticlockwise = diff < 0;
  const ARC_RADIUS = 20;
  ctx.save();
  ctx.strokeStyle = "#9333ea";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(vx, vy, ARC_RADIUS, theta1, theta2, anticlockwise);
  ctx.stroke();
  const mid = theta1 + diff / 2;
  const labelX = vx + (ARC_RADIUS + 14) * Math.cos(mid);
  const labelY = vy + (ARC_RADIUS + 14) * Math.sin(mid);
  ctx.fillStyle = "var(--muted)";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`${((angleRadians * 180) / Math.PI).toFixed(1)}°`, labelX, labelY);
  ctx.restore();
}

/** `drawAngle`'s exact theta1/theta2/diff/anticlockwise/labelX/labelY math, re-emitted as an `"arc"` + `"text"` SvgLayer pair instead of Canvas2D calls -- see that function's own doc comment for the geometry. */
function angleExportLayers(a: PointRecord, vertex: PointRecord, c: PointRecord, angleRadians: number): SvgLayer[] {
  const vx = toScreenX(vertex.x, VIEWPORT, WIDTH);
  const vy = toScreenY(vertex.y, VIEWPORT, HEIGHT);
  const ax = toScreenX(a.x, VIEWPORT, WIDTH);
  const ay = toScreenY(a.y, VIEWPORT, HEIGHT);
  const cx = toScreenX(c.x, VIEWPORT, WIDTH);
  const cy = toScreenY(c.y, VIEWPORT, HEIGHT);
  const theta1 = Math.atan2(ay - vy, ax - vx);
  const theta2 = Math.atan2(cy - vy, cx - vx);
  let diff = theta2 - theta1;
  while (diff <= -Math.PI) diff += 2 * Math.PI;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  const anticlockwise = diff < 0;
  const ARC_RADIUS = 20;
  const mid = theta1 + diff / 2;
  const labelX = vx + (ARC_RADIUS + 14) * Math.cos(mid);
  const labelY = vy + (ARC_RADIUS + 14) * Math.sin(mid);
  return [
    { kind: "arc", cxPx: vx, cyPx: vy, radiusPx: ARC_RADIUS, startAngle: theta1, endAngle: theta2, anticlockwise, color: "#9333ea", strokeWidth: 1.5 },
    { kind: "text", xPx: labelX, yPx: labelY, label: `${((angleRadians * 180) / Math.PI).toFixed(1)}°` },
  ];
}

/**
 * An ordered vertex loop, closed back to the first point -- a distinct color
 * from Line's/Circle's palette, switching to the degenerate warning color
 * when the loop self-intersects (a bowtie/figure-eight vertex order), since
 * the shoelace area isn't a meaningful "area" for such a shape. The area
 * value labels the polygon's signed-area-weighted centroid, mirroring
 * drawAngle's vertex label; when self-intersecting, the label says so
 * explicitly rather than presenting the number as trustworthy.
 */
function drawPolygon(ctx: CanvasRenderingContext2D, points: PointRecord[], area: number, selfIntersecting: boolean): void {
  if (points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = selfIntersecting ? DEGENERATE_COLOR : "#0891b2";
  ctx.lineWidth = 2;
  ctx.beginPath();
  const first = points[0] as PointRecord;
  ctx.moveTo(toScreenX(first.x, VIEWPORT, WIDTH), toScreenY(first.y, VIEWPORT, HEIGHT));
  for (let i = 1; i < points.length; i++) {
    const p = points[i] as PointRecord;
    ctx.lineTo(toScreenX(p.x, VIEWPORT, WIDTH), toScreenY(p.y, VIEWPORT, HEIGHT));
  }
  ctx.closePath();
  ctx.stroke();
  const centroid = polygonCentroid(points);
  ctx.fillStyle = selfIntersecting ? DEGENERATE_COLOR : "var(--muted)";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const label = selfIntersecting ? `${area.toFixed(2)} (self-intersecting)` : area.toFixed(2);
  ctx.fillText(label, toScreenX(centroid.x, VIEWPORT, WIDTH), toScreenY(centroid.y, VIEWPORT, HEIGHT));
  ctx.restore();
}

/** `drawPolygon`'s exact closed-loop + centroid-label logic, re-emitted as a closed `"polyline"` + `"text"` SvgLayer pair instead of Canvas2D calls -- the polyline is closed by re-appending the first point (mirroring `ctx.closePath()`), since `"polyline"` never auto-closes the way Canvas2D paths do. */
function polygonExportLayers(points: PointRecord[], area: number, selfIntersecting: boolean): SvgLayer[] {
  if (points.length < 2) return [];
  const first = points[0] as PointRecord;
  const centroid = polygonCentroid(points);
  const label = selfIntersecting ? `${area.toFixed(2)} (self-intersecting)` : area.toFixed(2);
  return [
    { kind: "polyline", points: [...points, first], color: selfIntersecting ? DEGENERATE_COLOR : "#0891b2", strokeWidth: 2 },
    {
      kind: "text",
      xPx: toScreenX(centroid.x, VIEWPORT, WIDTH),
      yPx: toScreenY(centroid.y, VIEWPORT, HEIGHT),
      label,
      color: selfIntersecting ? DEGENERATE_COLOR : undefined,
    },
  ];
}
