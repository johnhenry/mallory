import { type PointerEvent, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { type AngleUnit, angleUnitSuffix, formatAngle, getAngleUnit, radiansToUnit, setAngleUnit, subscribeToAngleUnit, unitToDegrees, unitToRadians } from "../lib/angle-unit.ts";
import { addLocalSave } from "../lib/local-saves.ts";
import { AlgebraView } from "./AlgebraView.tsx";
import { PngExportButton } from "./PngExportButton.tsx";
import { SvgExportButton } from "./SvgExportButton.tsx";
import { CellGraph } from "../lib/cell-graph.ts";
import {
  angleSweepRadians,
  interiorAngleRadians,
  isSelfIntersecting,
  pointInPolygon,
  pointToSegmentDistance,
  polygonCentroid,
  projectFractionOntoSegment,
  shoelaceArea,
  type AngleMode,
} from "../lib/geometry.ts";
import { deriveIKChain, solveIKChainCCD, type IKJointSpec } from "../lib/ik-chain.ts";
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
  type GeometryOpAngle,
  type GeometryOpRotation,
  type GeometryOpScale,
  type GeometryOpTranslation,
  type GeometryState,
} from "../lib/geometry-state.ts";

const WIDTH = 500;
const HEIGHT = 500;
const VIEWPORT: Viewport = { xMin: -5, xMax: 5, yMin: -5, yMax: 5 };
const HIT_RADIUS_PX = 14;
/** The fixed screen-space radius drawAngle/angleExportLayers draw the measurement arc at -- shared with nearestObjectId's angle hit test below so a click has to land near the actual drawn arc, not just "somewhere near the vertex". */
const ANGLE_ARC_RADIUS_PX = 20;
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
/** #336 item 1: the same red already used for an in-progress pending-click selection, reused here for a select-tool selection so the app has one consistent "this is selected" color rather than two. */
const SELECTED_HIGHLIGHT_COLOR = "#dc2626";

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
/** #336 item 2: only ever set when the user explicitly recolors a line/circle/polygon -- an un-recolored object has no cell here at all, so it keeps following the theme-aware/type default computed live at draw time instead of freezing a color chosen at construction. Not used for points (their free/dependent coloring is a meaningful signal, not decoration) or angle markers (a fixed measurement-arc indicator) -- see recolorGeometryObject's own doc comment. */
const colorCellId = (id: string) => `geomColor:${id}`;

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
  mode: AngleMode;
}
interface PolygonRecord {
  points: string[];
}

type Tool = "point" | "line" | "circle" | "reflect" | "rotate" | "translate" | "scale" | "angle" | "polygon" | "anchor" | "select";

/**
 * Tool palette groups (issue #252): "objects" are one-click-per-point
 * constructions that add a new object to `objectList` without reading or
 * requiring any extra numeric parameter -- Point, Line, Circle, Reflect,
 * Polygon all just chain together existing (or newly clicked) point ids.
 * "actions" are the three transforms that additionally need a typed-in
 * parameter (angle degrees / dx,dy / factor) via their own input box below
 * the palette, i.e. Rotate/Translate/Scale.
 *
 * Angle's placement is a judgment call flagged as an open question in the
 * issue, resolved here by how `addAngle` actually behaves rather than by
 * analogy: it defines an `angleRecordCellId`/`angleValueCellId` pair and
 * pushes to `objectList` exactly the way `addLine`/`addCircle`/`addPolygon`
 * split a record cell from a dependent-value cell (see their own doc
 * comments) -- a brand-new *object* that gets its own entry in the Objects
 * list and its own drawn/exported representation (`drawAngle`/
 * `angleExportLayers`). Crucially, unlike Reflect/Rotate/Translate/Scale
 * (which all `graph.define(pointCellId(id), ...)` -- i.e. produce a new
 * *point*, transforming/deriving from an existing one), Angle never touches
 * `pointCellId` at all: it only *reads* three existing points and never
 * moves or transforms anything. That makes it a construction/measurement
 * object, not an action performed on existing geometry, so it's grouped
 * with Objects alongside Line/Circle/Polygon (the other "read some points,
 * construct a new dependent-value object" tools) rather than with the
 * point-producing transforms.
 */
const OBJECT_TOOLS = ["point", "line", "circle", "reflect", "polygon", "angle", "anchor"] as const satisfies readonly Tool[];
const ACTION_TOOLS = ["rotate", "translate", "scale"] as const satisfies readonly Tool[];
/** #336 item 1: its own group rather than folded into Objects/Actions -- Select is a distinct MODE (click toggles membership in a multi-select set instead of building anything), not another one-click-per-point construction or typed-parameter action. */
const SELECT_TOOLS = ["select"] as const satisfies readonly Tool[];
const TOOL_GROUPS: { label: string; tools: readonly Tool[] }[] = [
  { label: "Objects", tools: OBJECT_TOOLS },
  { label: "Actions", tools: ACTION_TOOLS },
  { label: "Select", tools: SELECT_TOOLS },
];

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
        addLine(graph, listIds, op.a, op.b, op.id, op.color);
        break;
      case "circle":
        addCircle(graph, listIds, op.center, op.radiusPoint, op.id, op.color);
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
        addAngle(graph, listIds, op.a, op.vertex, op.c, op.id, op.mode ?? "shorter");
        break;
      case "polygon":
        addPolygon(graph, listIds, op.points, op.id, op.color);
        break;
      case "anchor":
        addAnchor(graph, listIds, op.target, op.param, op.id);
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
    graph.delete(colorCellId(id));
  }
  graph.set(listIds.objectList, [] as string[], { auxiliary: true });
  graph.set(listIds.opsLog, [] as GeometryOp[], { auxiliary: true });
}

/**
 * `useUndoHistory`'s `applyState`: reset to blank, then replay the target
 * snapshot's ops in order (issue #43's geometry adoption).
 *
 * #374/#375: `clearGeometryState`/`replayGeometryOps` each mutate many cells
 * one at a time (e.g. deleting every object's point cell in a loop, only
 * setting `objectList` back to `[]` at the very end). Without a single
 * `graph.transaction` around the whole sequence, `CellGraph`'s `subscribeAll`
 * notification -- which drives this panel's own canvas redraw -- fires after
 * EVERY individual `delete`/`set`/`define` call, not once at the end. That
 * let a redraw land mid-clear, where `objectList` still listed an id (e.g. a
 * line) whose referenced point cell had already been deleted by an earlier
 * iteration of the same loop -- `drawGeometryPanel`/`geometryExportLayers`
 * then read `.x`/`.y` off `graph.get`'s `undefined` for that missing cell,
 * producing exactly the reported "Cannot read properties of undefined"
 * crash. Wrapping the whole clear+replay as one logical write defers every
 * `subscribeAll` notification (and thus every redraw) until the graph is
 * fully consistent again.
 */
export function applyGeometryState(graph: CellGraph, listIds: CellIdsGeometry, state: GeometryState): void {
  graph.transaction(() => {
    clearGeometryState(graph, listIds);
    replayGeometryOps(graph, listIds, state.ops);
  });
}

/**
 * #336 item 4: a transform's op-log entry is the only place its numeric
 * parameters live -- `addRotation`/`addTranslate`/`addScale` bake them into
 * a `graph.define` closure at construction time, so mutating the op alone
 * wouldn't move the already-defined dependent point. Reusing
 * `applyGeometryState`'s full clear-and-replay (the same mechanism undo/
 * redo and hash-hydration already rely on) is what actually re-derives
 * every downstream cell against the new parameter -- more work than a
 * targeted single-cell update, but geometry construction logs are small
 * (an interactive tool, not a bulk import), so the O(n) rebuild is cheap,
 * and it's guaranteed correct for however deep the dependency chain runs.
 * Reusing the existing subscribeAll-driven undo recording for free: this
 * flows through the same graph.set calls applyGeometryState always did, so
 * an edit is itself undoable with no extra wiring.
 */
export function editGeometryOp(graph: CellGraph, listIds: CellIdsGeometry, opId: string, patch: Partial<GeometryOp>): void {
  editGeometryOps(graph, listIds, [{ opId, patch }]);
}

/**
 * Same shape as `editGeometryOp` but applies every patch in ONE clear-and-
 * replay instead of one rebuild per op -- the IK solver (#336 item 6) calls
 * this once per drag frame to update every joint in a chain together,
 * where N separate `editGeometryOp` calls would mean N full rebuilds per
 * frame instead of 1.
 */
export function editGeometryOps(graph: CellGraph, listIds: CellIdsGeometry, patches: { opId: string; patch: Partial<GeometryOp> }[]): void {
  const patchByOpId = new Map(patches.map((p) => [p.opId, p.patch]));
  const current = getCurrentGeometryState(graph, listIds);
  const ops = current.ops.map((op) => {
    const patch = patchByOpId.get(op.id);
    return patch ? ({ ...op, ...patch } as GeometryOp) : op;
  });
  applyGeometryState(graph, listIds, { v: 1, ops });
}

/**
 * #336 item 2: unlike `editGeometryOp`'s transform-parameter edit, a color
 * has no downstream `graph.define` dependents to re-derive -- it's a leaf
 * value read only at draw/export time -- so this skips the full clear-and-
 * replay rebuild entirely: `graph.set(colorCellId(id), color)` is enough
 * for the live canvas to pick it up (already subscribed via subscribeAll),
 * and the op-log entry is patched in place (a plain `graph.set` on the same
 * cell `pushOp` itself writes to) purely so the color survives save/undo/
 * URL-hash round-trips.
 *
 * Only meaningful for line/circle/polygon ops -- points keep their fixed
 * free/dependent coloring (a meaningful signal, not decoration) and angle
 * markers keep their fixed measurement-arc color; the UI never offers this
 * for those object types, but a caller passing a mismatched id is a no-op
 * here (the `.map` below simply finds nothing to patch).
 */
export function recolorGeometryObject(graph: CellGraph, listIds: CellIdsGeometry, id: string, color: string): void {
  graph.set(colorCellId(id), color);
  const ops = graph.get<GeometryOp[]>(listIds.opsLog).map((op) => (op.id === id ? ({ ...op, color } as GeometryOp) : op));
  graph.set(listIds.opsLog, ops, { auxiliary: true });
}

/**
 * Every id an op directly reads -- every op type's reference fields point
 * at point ids, EXCEPT `anchor`, whose `target` is a circle's or line's
 * own id (the one exception to the "only point ids" rule this function's
 * name still describes for every other op type; `computeCascadeDeleteIds`
 * doesn't care what TYPE a referenced id is, only whether it's being
 * deleted, so returning a non-point id here is enough for a deleted
 * circle/line to correctly cascade-delete any point anchored to it).
 */
function referencedPointIds(op: GeometryOp): string[] {
  switch (op.tool) {
    case "point":
      return [];
    case "line":
      return [op.a, op.b];
    case "circle":
      return [op.center, op.radiusPoint];
    case "reflection":
    case "rotation":
    case "scale":
      return [op.source, op.center];
    case "translation":
      return [op.source];
    case "angle":
      return [op.a, op.vertex, op.c];
    case "polygon":
      return [...op.points];
    case "anchor":
      return [op.target];
  }
}

/**
 * #336 item 3: deleting a point that a line/circle/transform/angle/polygon
 * still references would leave that dependent reading a now-gone
 * `pointCellId` -- so a delete has to cascade to every op that (directly or
 * transitively, e.g. deleting a rotation's own result point cascades to
 * whatever THAT point feeds) references the target, not just remove the
 * one op. Fixed-point expansion over the ops list rather than a bespoke
 * graph walk against CellGraph internals -- simple, and correct regardless
 * of how deep the chain runs. Deleting a line/circle/polygon (nothing else
 * ever references those ids, only point ids) is the trivial one-op case of
 * the same algorithm, not a special case.
 */
function computeCascadeDeleteIds(ops: GeometryOp[], rootId: string): Set<string> {
  const toDelete = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const op of ops) {
      if (toDelete.has(op.id)) continue;
      if (referencedPointIds(op).some((refId) => toDelete.has(refId))) {
        toDelete.add(op.id);
        changed = true;
      }
    }
  }
  return toDelete;
}

/**
 * Removes `targetId` and everything that depends on it (see
 * `computeCascadeDeleteIds`), via the same clear-and-replay
 * `applyGeometryState` uses for undo/redo and `editGeometryOp` -- correct
 * for however deep the dependency chain runs, and undoable for free via
 * the same subscribeAll-driven history recording. Returns the full set of
 * removed ids so the caller can prune its own selection state of ids that
 * no longer exist.
 */
export function deleteGeometryObject(graph: CellGraph, listIds: CellIdsGeometry, targetId: string): Set<string> {
  const current = getCurrentGeometryState(graph, listIds);
  const toDelete = computeCascadeDeleteIds(current.ops, targetId);
  const ops = current.ops.filter((op) => !toDelete.has(op.id));
  applyGeometryState(graph, listIds, { v: 1, ops });
  return toDelete;
}

/** A short, stable-enough label for a point id in this editor -- its 1-based position in construction order (points have no user-facing name anywhere else in this panel either). Falls back to a truncated id if somehow not in the object list (shouldn't happen for a live reference). */
function pointLabel(graph: CellGraph, listIds: CellIdsGeometry, id: string): string {
  const index = graph.get<string[]>(listIds.objectList).indexOf(id);
  return index >= 0 ? `point ${index + 1}` : id.slice(0, 6);
}

/**
 * #336 item 4: rotation/translation/scale ops carry the only editable
 * numeric parameters this panel has (angle, dx/dy, factor) -- everything
 * else about an object (which points it references) is fixed at
 * construction. Lists every such op with a live-editable input, applying
 * through `editGeometryOp` on change (debounced so a drag/type doesn't
 * fire a full rebuild per keystroke).
 *
 * Subscribes narrowly to `listIds.opsLog` (not the whole graph, unlike
 * `AlgebraView`) since that's the one cell this editor's own list depends
 * on -- `graph.subscribeMany` fires only on an actual write to that id.
 *
 * Also lists angle ops, whose `mode` (see `AngleMode`'s own doc comment)
 * is the same kind of "fixed at construction, editable after the fact"
 * parameter -- a `<select>` instead of a numeric input, applied
 * immediately on change (a discrete choice, not a keystroke stream, so no
 * debounce needed the way the numeric inputs below use).
 *
 * `selected` highlights a row when its own object is currently selected
 * (a transform/angle's id doubles as its point/arc's id) -- a lightweight
 * link between this always-visible list and the select tool's multi-
 * select, short of fully merging the two (see the "smaller middle ground"
 * design discussion this implements).
 */
function TransformParamsEditor({
  graph,
  listIds,
  angleUnit,
  selected,
}: {
  graph: CellGraph;
  listIds: CellIdsGeometry;
  angleUnit: AngleUnit;
  selected: ReadonlySet<string>;
}) {
  const ops = useSyncExternalStore(
    useCallback((onChange) => graph.subscribeMany([listIds.opsLog], onChange), [graph, listIds.opsLog]),
    () => graph.get<GeometryOp[]>(listIds.opsLog),
    () => graph.get<GeometryOp[]>(listIds.opsLog),
  );
  const editable = ops.filter((op): op is GeometryOpRotation | GeometryOpTranslation | GeometryOpScale | GeometryOpAngle =>
    op.tool === "rotation" || op.tool === "translation" || op.tool === "scale" || op.tool === "angle",
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function debouncedEdit(opId: string, patch: Partial<GeometryOp>) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => editGeometryOp(graph, listIds, opId, patch), 200);
  }

  if (editable.length === 0) return null;
  return (
    <div style={{ margin: "0.5rem 0" }}>
      <div style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: "0.25rem" }}>Adjust transforms &amp; angles</div>
      <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.85rem" }}>
        {editable.map((op) => (
          <li
            key={op.id}
            style={{
              margin: "0.2rem 0",
              ...(selected.has(op.id) ? { color: SELECTED_HIGHLIGHT_COLOR, fontWeight: 600 } : {}),
            }}
          >
            {op.tool === "rotation" && (
              <label>
                Rotation of {pointLabel(graph, listIds, op.source)} around {pointLabel(graph, listIds, op.center)}, angle (
                {angleUnitSuffix(angleUnit).trim() || "rad"}):{" "}
                <input
                  type="number"
                  defaultValue={radiansToUnit(unitToRadians(op.angleDegrees, "degrees"), angleUnit)}
                  onChange={(e) => {
                    const typed = Number(e.target.value);
                    if (Number.isFinite(typed)) debouncedEdit(op.id, { angleDegrees: unitToDegrees(typed, angleUnit) } as Partial<GeometryOp>);
                  }}
                  style={{ font: "inherit", width: "6ch" }}
                />
              </label>
            )}
            {op.tool === "translation" && (
              <label>
                Translation of {pointLabel(graph, listIds, op.source)}, dx:{" "}
                <input
                  type="number"
                  defaultValue={op.dx}
                  onChange={(e) => {
                    const typed = Number(e.target.value);
                    if (Number.isFinite(typed)) debouncedEdit(op.id, { dx: typed } as Partial<GeometryOp>);
                  }}
                  style={{ font: "inherit", width: "6ch" }}
                />{" "}
                dy:{" "}
                <input
                  type="number"
                  defaultValue={op.dy}
                  onChange={(e) => {
                    const typed = Number(e.target.value);
                    if (Number.isFinite(typed)) debouncedEdit(op.id, { dy: typed } as Partial<GeometryOp>);
                  }}
                  style={{ font: "inherit", width: "6ch" }}
                />
              </label>
            )}
            {op.tool === "scale" && (
              <label>
                Scale of {pointLabel(graph, listIds, op.source)} from {pointLabel(graph, listIds, op.center)}, factor:{" "}
                <input
                  type="number"
                  defaultValue={op.factor}
                  onChange={(e) => {
                    const typed = Number(e.target.value);
                    if (Number.isFinite(typed)) debouncedEdit(op.id, { factor: typed } as Partial<GeometryOp>);
                  }}
                  style={{ font: "inherit", width: "6ch" }}
                />
              </label>
            )}
            {op.tool === "angle" && (
              <label>
                Angle {pointLabel(graph, listIds, op.a)}-{pointLabel(graph, listIds, op.vertex)}-{pointLabel(graph, listIds, op.c)}, mode:{" "}
                <select value={op.mode ?? "shorter"} onChange={(e) => editGeometryOp(graph, listIds, op.id, { mode: e.target.value as AngleMode })}>
                  <option value="shorter">Shorter (≤180°)</option>
                  <option value="clickOrder">Click order (A→C)</option>
                  <option value="reflex">Reflex (≥180°)</option>
                </select>
              </label>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * #336 items 2-3: recolor + delete for whatever's currently in `selected`.
 * Delete applies to any selected object (points included -- cascading to
 * whatever else references it, see `deleteGeometryObject`'s own doc
 * comment). Recolor only lists a color picker when the selection includes
 * at least one line/circle/polygon -- points keep their fixed free/
 * dependent coloring (a meaningful signal) and angle markers keep their
 * fixed measurement-arc color, so recoloring a selection that's ONLY
 * points/angles has nothing to offer a color picker for.
 */
/**
 * #336 item 6: an IK chain is derived from `selected` (see ik-chain.ts's
 * deriveIKChain), not carried in it -- once designated, the chain outlives
 * the selection that produced it (clearing selected/switching tools
 * shouldn't drop the chain, since it's a distinct interaction affordance,
 * not a selection). This renders even with an empty selection, whenever a
 * chain is currently active, unlike the recolor/delete controls above it.
 */
function IKChainControls({
  graph,
  listIds,
  selected,
  ikChain,
  setIkChain,
}: {
  graph: CellGraph;
  listIds: CellIdsGeometry;
  selected: Set<string>;
  ikChain: string[] | null;
  setIkChain: (next: string[] | null) => void;
}) {
  const candidate = selected.size > 0 ? deriveIKChain(getCurrentGeometryState(graph, listIds).ops, selected) : null;

  if (!ikChain && !candidate) return null;
  return (
    <div style={{ margin: "0.5rem 0", display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", fontSize: "0.85rem" }}>
      {ikChain && (
        <>
          <span>
            IK chain active ({ikChain.length} joint{ikChain.length === 1 ? "" : "s"}) -- drag the dashed teal point to solve.
          </span>
          <button type="button" onClick={() => setIkChain(null)}>
            Clear IK chain
          </button>
        </>
      )}
      {candidate?.ok && (
        <button type="button" onClick={() => setIkChain(candidate.chain)} title="The selected rotations must form one unbroken sequence.">
          Set as IK chain ({candidate.chain.length} joint{candidate.chain.length === 1 ? "" : "s"})
        </button>
      )}
      {candidate && !candidate.ok && <span style={{ color: "var(--danger)" }}>{candidate.message}</span>}
    </div>
  );
}

function SelectionControls({
  graph,
  listIds,
  selected,
  setSelected,
}: {
  graph: CellGraph;
  listIds: CellIdsGeometry;
  selected: Set<string>;
  setSelected: (next: Set<string>) => void;
}) {
  if (selected.size === 0) return null;
  const ids = [...selected];
  const recolorable = ids.filter((id) => graph.has(lineCellId(id)) || graph.has(circleCellId(id)) || graph.has(polygonCellId(id)));

  function handleDelete() {
    // deleteGeometryObject re-reads the ops log fresh each call and no-ops
    // if the target's already gone -- safe to call for every originally-
    // selected id even when an earlier call in this same loop already
    // cascade-removed it (e.g. selecting both a point and a line built
    // from it).
    for (const id of ids) deleteGeometryObject(graph, listIds, id);
    setSelected(new Set());
  }

  return (
    <div style={{ margin: "0.5rem 0", display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", fontSize: "0.85rem" }}>
      <span style={{ fontWeight: 600 }}>{selected.size} selected:</span>
      {recolorable.length > 0 && (
        <label>
          Recolor:{" "}
          <input
            type="color"
            defaultValue="#2563eb"
            onChange={(e) => {
              for (const id of recolorable) recolorGeometryObject(graph, listIds, id, e.target.value);
            }}
            title={`Applies to the ${recolorable.length} selected line(s)/circle(s)/polygon(s) -- points keep their fixed color.`}
          />
        </label>
      )}
      <button type="button" onClick={handleDelete}>
        Delete selected
      </button>
      <button type="button" onClick={() => setSelected(new Set())}>
        Clear selection
      </button>
    </div>
  );
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

/**
 * True iff `clickTheta` (any real radian value) falls within the swept
 * wedge from `theta1` by signed sweep `delta` (as `angleSweepRadians`
 * returns -- positive means CCW, negative CW, magnitude up to just under
 * 2*PI for `"clickOrder"`/`"reflex"` mode). Normalizes the click into the
 * `[0, 2*PI)` CCW-from-`theta1` frame first, then checks it against
 * `[0, delta]` (delta >= 0) or its wrap-around complement `[delta+2*PI,
 * 2*PI)` (delta < 0) -- the two cases can't share one inequality since
 * "CCW by a positive amount" and "CW by a negative amount" occupy
 * opposite ends of that normalized range.
 */
function withinAngleWedge(clickTheta: number, theta1: number, delta: number): boolean {
  const TWO_PI = 2 * Math.PI;
  let rawClick = (clickTheta - theta1) % TWO_PI;
  if (rawClick < 0) rawClick += TWO_PI; // [0, 2*PI)
  return delta >= 0 ? rawClick <= delta : rawClick >= delta + TWO_PI;
}

/**
 * Data-space distance from `(x, y)` to the arc `drawAngle` actually draws
 * for this angle record, or `Infinity` if the click falls outside the
 * swept wedge between the two rays (a click near the vertex but on the
 * wrong side of it is a miss, same as a click far from a line segment
 * along its infinite extension is a miss for `pointToSegmentDistance`).
 * Reuses `angleSweepRadians` (the same primitive `drawAngle`'s screen-
 * space sweep uses) but in DATA space -- GeometryPanel has no pan/zoom
 * (fixed `VIEWPORT`/`WIDTH`/`HEIGHT`), so `ANGLE_ARC_RADIUS_PX` converts to
 * a fixed data-space radius via the same ratio `currentHitDataRadius` uses.
 * Data-space y isn't screen-flipped, which mirrors the wedge relative to
 * `drawAngle`'s own screen-space computation -- harmless since only the
 * wedge's *shape* (the swept region between the two rays) is being
 * tested, not compared against any external clockwise/anticlockwise
 * convention.
 */
function distanceToAngleArc(a: PointRecord, vertex: PointRecord, c: PointRecord, x: number, y: number, mode: AngleMode): number {
  const arcRadius = (ANGLE_ARC_RADIUS_PX / WIDTH) * (VIEWPORT.xMax - VIEWPORT.xMin);
  const theta1 = Math.atan2(a.y - vertex.y, a.x - vertex.x);
  const theta2 = Math.atan2(c.y - vertex.y, c.x - vertex.x);
  const delta = angleSweepRadians(theta1, theta2, mode);
  const clickTheta = Math.atan2(y - vertex.y, x - vertex.x);
  if (!withinAngleWedge(clickTheta, theta1, delta)) return Infinity;
  return Math.abs(Math.hypot(x - vertex.x, y - vertex.y) - arcRadius);
}

/**
 * #336 item 1: every other tool's click-handling only ever needs
 * `nearestPointId` (line/circle/reflect/rotate/scale/angle/polygon all
 * connect existing POINTS), so this broader hit test -- checking lines,
 * circles, polygons, and angle markers too, via `pointToSegmentDistance`/
 * circle-boundary-distance/`pointInPolygon`/`distanceToAngleArc` -- is
 * scoped to the select tool only, not threaded into the other tools'
 * construction flows. Points are checked first (smallest, most precise
 * target); a click "inside" a polygon, "near" a line/circle's boundary, or
 * "on" an angle's measurement arc within the hit radius counts as a hit.
 */
function nearestObjectId(graph: CellGraph, listIds: CellIdsGeometry, x: number, y: number, maxDistance: number): string | null {
  const point = nearestPointId(graph, listIds, x, y, maxDistance);
  if (point) return point;
  let best: string | null = null;
  let bestDist = maxDistance;
  for (const id of graph.get<string[]>(listIds.objectList)) {
    if (graph.has(lineCellId(id))) {
      const { a, b } = graph.get<LineRecord>(lineCellId(id));
      const d = pointToSegmentDistance({ x, y }, graph.get<PointRecord>(pointCellId(a)), graph.get<PointRecord>(pointCellId(b)));
      if (d < bestDist) {
        bestDist = d;
        best = id;
      }
    } else if (graph.has(circleCellId(id))) {
      const { center } = graph.get<CircleRecord>(circleCellId(id));
      const pc = graph.get<PointRecord>(pointCellId(center));
      const radius = graph.get<number>(radiusCellId(id));
      const d = Math.abs(Math.hypot(pc.x - x, pc.y - y) - radius);
      if (d < bestDist) {
        bestDist = d;
        best = id;
      }
    } else if (graph.has(polygonCellId(id))) {
      const { points } = graph.get<PolygonRecord>(polygonCellId(id));
      const pts = points.map((pid) => graph.get<PointRecord>(pointCellId(pid)));
      if (pointInPolygon({ x, y }, pts)) {
        // Interior click has no natural "distance" to compare against a
        // boundary miss elsewhere -- treat any interior hit as exact (0)
        // so it wins over anything found so far within maxDistance.
        bestDist = 0;
        best = id;
      }
    } else if (graph.has(angleRecordCellId(id))) {
      const { a, vertex, c, mode } = graph.get<AngleRecord>(angleRecordCellId(id));
      const d = distanceToAngleArc(
        graph.get<PointRecord>(pointCellId(a)),
        graph.get<PointRecord>(pointCellId(vertex)),
        graph.get<PointRecord>(pointCellId(c)),
        x,
        y,
        mode ?? "shorter",
      );
      if (d < bestDist) {
        bestDist = d;
        best = id;
      }
    }
  }
  return best;
}

/** Circle/line hits only (no points, no polygons) -- the anchor tool's own click target, a click on empty space or on a point/polygon is a miss. */
function nearestCircleOrLineId(graph: CellGraph, listIds: CellIdsGeometry, x: number, y: number, maxDistance: number): string | null {
  let best: string | null = null;
  let bestDist = maxDistance;
  for (const id of graph.get<string[]>(listIds.objectList)) {
    if (graph.has(lineCellId(id))) {
      const { a, b } = graph.get<LineRecord>(lineCellId(id));
      const d = pointToSegmentDistance({ x, y }, graph.get<PointRecord>(pointCellId(a)), graph.get<PointRecord>(pointCellId(b)));
      if (d < bestDist) {
        bestDist = d;
        best = id;
      }
    } else if (graph.has(circleCellId(id))) {
      const { center } = graph.get<CircleRecord>(circleCellId(id));
      const pc = graph.get<PointRecord>(pointCellId(center));
      const radius = graph.get<number>(radiusCellId(id));
      const d = Math.abs(Math.hypot(pc.x - x, pc.y - y) - radius);
      if (d < bestDist) {
        bestDist = d;
        best = id;
      }
    }
  }
  return best;
}

/** The nearest currently-anchored point within `maxDistance` -- checked separately from `nearestPointId`'s free-point check, since an anchored point is a dependent (`graph.define`d) cell, deliberately excluded from ordinary free-point dragging. */
function nearestAnchorPointId(graph: CellGraph, listIds: CellIdsGeometry, x: number, y: number, maxDistance: number): string | null {
  let best: string | null = null;
  let bestDist = maxDistance;
  for (const op of getCurrentGeometryState(graph, listIds).ops) {
    if (op.tool !== "anchor" || !graph.has(pointCellId(op.id))) continue;
    const p = graph.get<PointRecord>(pointCellId(op.id));
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestDist) {
      bestDist = d;
      best = op.id;
    }
  }
  return best;
}

/** Computes the `param` (angle for a circle target, clamped 0..1 fraction for a line target) that puts an anchored point as close as possible to `(x, y)` -- shared by the anchor tool's click-to-create flow and drag-to-reposition. */
function anchorParamForPosition(graph: CellGraph, target: string, x: number, y: number): number {
  if (graph.has(circleCellId(target))) {
    const { center } = graph.get<CircleRecord>(circleCellId(target));
    const c = graph.get<PointRecord>(pointCellId(center));
    return Math.atan2(y - c.y, x - c.x);
  }
  const { a, b } = graph.get<LineRecord>(lineCellId(target));
  const pa = graph.get<PointRecord>(pointCellId(a));
  const pb = graph.get<PointRecord>(pointCellId(b));
  return projectFractionOntoSegment({ x, y }, pa, pb);
}

function addPoint(graph: CellGraph, listIds: CellIdsGeometry, x: number, y: number, id: string = crypto.randomUUID()): string {
  graph.set(pointCellId(id), { x, y });
  pushObject(graph, listIds, id);
  pushOp(graph, listIds, { tool: "point", id, x, y });
  return id;
}

function addLine(graph: CellGraph, listIds: CellIdsGeometry, a: string, b: string, id: string = crypto.randomUUID(), color?: string): void {
  graph.set(lineCellId(id), { a, b });
  graph.define(lengthCellId(id), () => {
    const pa = graph.get<PointRecord>(pointCellId(a));
    const pb = graph.get<PointRecord>(pointCellId(b));
    return Math.hypot(pa.x - pb.x, pa.y - pb.y);
  });
  if (color !== undefined) graph.set(colorCellId(id), color);
  pushObject(graph, listIds, id);
  pushOp(graph, listIds, color !== undefined ? { tool: "line", id, a, b, color } : { tool: "line", id, a, b });
}

function addCircle(
  graph: CellGraph,
  listIds: CellIdsGeometry,
  center: string,
  radiusPoint: string,
  id: string = crypto.randomUUID(),
  color?: string,
): void {
  graph.set(circleCellId(id), { center, radiusPoint });
  graph.define(radiusCellId(id), () => {
    const pc = graph.get<PointRecord>(pointCellId(center));
    const pr = graph.get<PointRecord>(pointCellId(radiusPoint));
    return Math.hypot(pc.x - pr.x, pc.y - pr.y);
  });
  if (color !== undefined) graph.set(colorCellId(id), color);
  pushObject(graph, listIds, id);
  pushOp(graph, listIds, color !== undefined ? { tool: "circle", id, center, radiusPoint, color } : { tool: "circle", id, center, radiusPoint });
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

/**
 * Interior angle ABC at `vertex`, reading all three points live -- same
 * record/dependent-value split as Line/Circle. `mode` picks which of the
 * two candidate angles (see AngleMode's own doc comment) is measured; it's
 * captured in the `angleValueCellId` closure at construction time, same as
 * `angleDegrees`/`dx`/`dy`/`factor` are for rotation/translation/scale --
 * changing it later goes through `editGeometryOp`, which clears and
 * replays every op (rebuilding this closure with the new value), not a
 * live-reactive cell.
 */
function addAngle(graph: CellGraph, listIds: CellIdsGeometry, a: string, vertex: string, c: string, id: string = crypto.randomUUID(), mode: AngleMode = "shorter"): void {
  graph.set(angleRecordCellId(id), { a, vertex, c, mode } as AngleRecord);
  graph.define(angleValueCellId(id), (): number => {
    const pa = graph.get<PointRecord>(pointCellId(a));
    const pv = graph.get<PointRecord>(pointCellId(vertex));
    const pc = graph.get<PointRecord>(pointCellId(c));
    return interiorAngleRadians(pa, pv, pc, mode);
  });
  pushObject(graph, listIds, id);
  pushOp(graph, listIds, { tool: "angle", id, a, vertex, c, mode });
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
function addPolygon(graph: CellGraph, listIds: CellIdsGeometry, points: string[], id: string = crypto.randomUUID(), color?: string): void {
  graph.set(polygonCellId(id), { points } as PolygonRecord);
  graph.define(areaCellId(id), (): number => {
    const pts = points.map((pid) => graph.get<PointRecord>(pointCellId(pid)));
    return shoelaceArea(pts);
  });
  graph.define(polygonSelfIntersectingCellId(id), (): boolean => {
    const pts = points.map((pid) => graph.get<PointRecord>(pointCellId(pid)));
    return isSelfIntersecting(pts);
  });
  if (color !== undefined) graph.set(colorCellId(id), color);
  pushObject(graph, listIds, id);
  pushOp(graph, listIds, color !== undefined ? { tool: "polygon", id, points, color } : { tool: "polygon", id, points });
}

/**
 * A point pinned to a specific spot on an existing circle or line --
 * `param` is an angle in radians (circle) or a 0..1 fraction along the
 * segment (line), read live off `target`'s CURRENT geometry, so it moves
 * correctly if the circle/line's own defining points move. Which
 * interpretation applies is derived from what `target` currently is
 * (`graph.has(circleCellId(target))` vs `lineCellId(target)`), not stored
 * separately -- an anchor can't outlive its target anyway (deleting the
 * target cascades to delete every point anchored to it, see
 * `referencedPointIds`'s "anchor" case).
 */
function addAnchor(graph: CellGraph, listIds: CellIdsGeometry, target: string, param: number, id: string = crypto.randomUUID()): void {
  graph.define(pointCellId(id), (): PointRecord => {
    if (graph.has(circleCellId(target))) {
      const { center } = graph.get<CircleRecord>(circleCellId(target));
      const c = graph.get<PointRecord>(pointCellId(center));
      const radius = graph.get<number>(radiusCellId(target));
      return { x: c.x + radius * Math.cos(param), y: c.y + radius * Math.sin(param) };
    }
    if (graph.has(lineCellId(target))) {
      const { a, b } = graph.get<LineRecord>(lineCellId(target));
      const pa = graph.get<PointRecord>(pointCellId(a));
      const pb = graph.get<PointRecord>(pointCellId(b));
      return { x: pa.x + param * (pb.x - pa.x), y: pa.y + param * (pb.y - pa.y) };
    }
    throw new Error("An anchor's target must be an existing circle or line.");
  });
  pushObject(graph, listIds, id);
  pushOp(graph, listIds, { tool: "anchor", id, target, param });
}

export interface GeometryPanelProps {
  /** Share an existing CellGraph (e.g. from a notebook block) instead of creating a private one. */
  graph?: CellGraph;
  /** Hydrate from and write to the URL fragment. Off for a notebook-embedded instance, whose document owns persistence instead. */
  syncUrl?: boolean;
  /** Namespaces this construction's object-list/ops-log cells and WebMCP tool names (e.g. a notebook block's own id), so more than one construction can share a CellGraph. Defaults to a stable single-instance value for the standalone page. */
  cellId?: string;
}

/**
 * Pure re-render of the construction canvas, extracted from the redraw
 * effect below so `PngExportButton`'s `renderAtScale` (issue #278) can
 * call it against a fresh offscreen canvas at any size. `pending`/
 * `pendingAngle`/`pendingPolygon` aren't graph state (they're the
 * in-progress-selection UI state), so they're passed explicitly rather
 * than read off `graph`.
 */
export function drawGeometryPanel(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  graph: CellGraph,
  listIds: CellIdsGeometry,
  pending: string | null,
  pendingAngle: string[],
  pendingPolygon: string[],
  angleUnit: AngleUnit = "radians",
  selected: ReadonlySet<string> = new Set(),
  ikEndEffectorId: string | null = null,
): void {
  ctx.clearRect(0, 0, width, height);
  drawAxes(ctx, VIEWPORT, width, height);
  for (const id of graph.get<string[]>(listIds.objectList)) {
    if (graph.has(pointCellId(id))) {
      const p = graph.get<PointRecord>(pointCellId(id));
      const isFree = graph.role(pointCellId(id)) === "free";
      const isPendingSelection = id === pending || pendingAngle.includes(id) || pendingPolygon.includes(id);
      const color = isPendingSelection || selected.has(id) ? SELECTED_HIGHLIGHT_COLOR : isFree ? "#2563eb" : "var(--muted)";
      drawDot(ctx, p.x, p.y, color);
      // #336 item 6: a ring around the IK chain's end effector -- the one
      // dependent point in this panel that's draggable, so it needs its
      // own visual cue distinguishing it from every other (non-draggable)
      // dependent point drawn with the same muted color above.
      if (id === ikEndEffectorId) drawIKEndEffectorRing(ctx, p.x, p.y);
    } else if (graph.has(lineCellId(id))) {
      const { a, b } = graph.get<LineRecord>(lineCellId(id));
      const pa = graph.get<PointRecord>(pointCellId(a));
      const pb = graph.get<PointRecord>(pointCellId(b));
      const length = graph.get<number>(lengthCellId(id));
      const customColor = graph.has(colorCellId(id)) ? graph.get<string>(colorCellId(id)) : null;
      drawLine(ctx, pa, pb, length < DEGENERATE_EPSILON, customColor, selected.has(id));
    } else if (graph.has(circleCellId(id))) {
      const { center, radiusPoint } = graph.get<CircleRecord>(circleCellId(id));
      const pc = graph.get<PointRecord>(pointCellId(center));
      const radius = graph.get<number>(radiusCellId(id));
      const customColor = graph.has(colorCellId(id)) ? graph.get<string>(colorCellId(id)) : null;
      drawCircle(ctx, pc, radius, radius < DEGENERATE_EPSILON, customColor, selected.has(id));
    } else if (graph.has(angleRecordCellId(id))) {
      const { a, vertex, c, mode } = graph.get<AngleRecord>(angleRecordCellId(id));
      const pa = graph.get<PointRecord>(pointCellId(a));
      const pv = graph.get<PointRecord>(pointCellId(vertex));
      const pc = graph.get<PointRecord>(pointCellId(c));
      const angle = graph.get<number>(angleValueCellId(id));
      drawAngle(ctx, pa, pv, pc, angle, angleUnit, mode ?? "shorter", selected.has(id));
    } else if (graph.has(polygonCellId(id))) {
      const { points } = graph.get<PolygonRecord>(polygonCellId(id));
      const pts = points.map((pid) => graph.get<PointRecord>(pointCellId(pid)));
      const area = graph.get<number>(areaCellId(id));
      const selfIntersecting = graph.get<boolean>(polygonSelfIntersectingCellId(id));
      const customColor = graph.has(colorCellId(id)) ? graph.get<string>(colorCellId(id)) : null;
      drawPolygon(ctx, pts, area, selfIntersecting, customColor, selected.has(id));
    }
  }
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
  // A global, localStorage-backed preference (angle-unit.ts) rather than
  // component-local state that would reset on remount -- shared with
  // ComplexPanel's arg() display, so switching it here also flips that
  // panel next time it renders.
  const [angleUnit, setAngleUnitState] = useState<AngleUnit>(getAngleUnit());
  useEffect(() => subscribeToAngleUnit(setAngleUnitState), []);
  // #336 item 1: a real multi-select set, distinct from `pending`/
  // `pendingAngle`/`pendingPolygon` above (those are transient in-progress-
  // construction state, cleared the moment a construction completes or the
  // tool changes; a selection persists across redraws until the user
  // deselects). Only ever populated while `tool === "select"`.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // #336 item 6: an ordered base-to-end-effector list of rotation op ids
  // (see ik-chain.ts's deriveIKChain), designated from a valid selection.
  // Not persisted to the graph/URL -- it's a pure interaction affordance
  // ("dragging this specific already-existing point now solves instead of
  // being a no-op"), not new geometry, so it lives here alongside
  // pending/selected rather than in opsLog.
  const [ikChain, setIkChain] = useState<string[] | null>(null);
  const dragRef = useRef<{ id: string; moved: boolean; startSx: number; startSy: number; kind: "free" | "solve" | "anchor" } | null>(null);

  useCellGraphTools(toolPrefix, graph);

  // Standalone only (issue #43, same enabled:syncUrl pattern as the other
  // panel adoptions): a notebook-embedded instance shares its graph with
  // NotebookPanel's own useUndoHistory, so a second independent history
  // here would double-fire on Ctrl+Z. applyState also resets any
  // in-progress multi-click selection (pending/pendingAngle/pendingPolygon),
  // the select-tool `selected` set (#336 item 1), and any designated IK
  // chain (#336 item 6) -- all of those hold ids that may not exist in the
  // restored snapshot, so completing an in-progress construction (or
  // recoloring/deleting/solving against a stale reference) across an
  // undo/redo would reference a now-nonexistent object.
  const history = useUndoHistory(
    graph,
    () => getCurrentGeometryState(graph, listIds),
    (state) => {
      applyGeometryState(graph, listIds, state);
      setPending(null);
      setPendingAngle([]);
      setPendingPolygon([]);
      setSelected(new Set());
      setIkChain(null);
      // #374/#375: undo/redo is a DOCUMENT-level Ctrl/Cmd+Z listener (see
      // useUndoHistory's own doc comment), entirely independent of this
      // canvas's own pointer handlers -- it can fire mid-drag (a natural
      // "abort this drag" instinct: hit Cmd+Z while still holding the mouse
      // button down). `dragRef` holds the id being dragged and, unlike
      // pending/pendingAngle/pendingPolygon/selected/ikChain above, was
      // never cleared here -- the NEXT pointermove/pointerup after an
      // undo/redo would then read a point cell for an id the restored
      // snapshot may no longer contain. `CellGraph.get` on a nonexistent
      // cell returns `undefined` rather than throwing (see cell-graph.ts's
      // own `ensure`), so every one of `handlePointerMove`'s three drag
      // kinds ends up reading `.x`/`.y` off `undefined` -- exactly the
      // "Cannot read properties of undefined (reading 'x'/'y')" crash both
      // issues reported. Resetting it here closes the gap the same way
      // every other piece of transient interaction state already does.
      dragRef.current = null;
    },
    250,
    undefined,
    syncUrl,
  );

  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  async function handleSave() {
    const title = window.prompt("Title for this saved construction:", "Untitled");
    if (title === null) return;
        try {
      addLocalSave({ title, kind: "geometry", state: getCurrentGeometryState(graph, listIds) });
      setSaveStatus(`Saved as "${title || "Untitled"}" to My saves on this device — reopen or publish it from the gallery.`);
    } catch (e) {
      setSaveStatus(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Keep the URL fragment in sync with the live construction log, mirroring OdePanel's pattern.
  // subscribeMany (not subscribeAll, issue #242 -- follow-up to #235) --
  // getCurrentGeometryState only reads listIds.opsLog, so a subscribeAll
  // here used to re-run writeUrl on every pointermove while dragging an
  // existing point (which writes that point's live position cell, not
  // opsLog) even though the URL never encodes live drag position. This
  // panel's own `redraw` effect below is a different, correctly-scoped
  // case -- it stays subscribeAll (its output genuinely depends on every
  // object's live position during the same drag).
  useEffect(() => {
    if (!syncUrl) return;
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeGeometryState(getCurrentGeometryState(graph, listIds))}`);
    }
    writeUrl();
    return graph.subscribeMany([listIds.opsLog], writeUrl);
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

  useModelContextTool({
    name: `${toolPrefix}_add_anchor`,
    description:
      "Pin a point to a specific spot on an existing circle or line (by id) -- an angle in radians for a circle, or a 0..1 fraction along the segment for a line. Returns the new point's id.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "An existing circle or line's id." },
        param: { type: "number", description: "Angle in radians (circle) or 0..1 fraction along the segment (line)." },
      },
      required: ["target", "param"],
    },
    handler: (input: Record<string, unknown>) => {
      const target = String(input.target);
      if (!graph.has(circleCellId(target)) && !graph.has(lineCellId(target))) throw new Error(`"${target}" is not an existing circle or line.`);
      const id = crypto.randomUUID();
      addAnchor(graph, listIds, target, Number(input.param), id);
      return { id };
    },
  });

  function dataCoordsFromEvent(e: PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const { sx, sy } = canvasEventPoint(e, e.currentTarget, WIDTH, HEIGHT);
    return { x: toDataX(sx, VIEWPORT, WIDTH), y: toDataY(sy, VIEWPORT, HEIGHT) };
  }

  /** Toggles `id`'s selection membership -- shared by both a point hit (via handlePointClick below) and a line/circle/polygon hit (via handlePointerUp's own select-tool branch), since selection doesn't care about object type. */
  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** A plain (no-drag) click landing on an existing point -- free or dependent. */
  function handlePointClick(hitId: string) {
    if (tool === "select") {
      toggleSelected(hitId);
      return;
    }
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
    else if (tool === "rotate") {
      // addRotation's angleDegrees param (and the op's storage) is
      // degrees-typed regardless of display preference -- convert the
      // typed value (in whatever unit is currently selected) at this one
      // boundary. Fallback is a quarter turn, expressed in the current unit.
      const angleFallback = angleUnit === "degrees" ? 90 : Math.PI / 2;
      addRotation(graph, listIds, pending, hitId, unitToDegrees(Number(angleInput) || angleFallback, angleUnit));
    }
    else if (tool === "scale") addScale(graph, listIds, pending, hitId, Number(factorInput) || 2);
    setPending(null);
  }

  function handleEmptyClick(x: number, y: number) {
    if (tool === "point") addPoint(graph, listIds, x, y);
    // every other tool only connects existing points -- clicking empty space is a no-op
  }

  /**
   * #336 item 6: reads the chain's current joints (center point positions
   * + angleDegrees) and base point straight off the live graph, runs CCD
   * toward `(targetX, targetY)`, and applies every solved angle in ONE
   * `editGeometryOps` call -- a live-drag callback fires every pointermove,
   * so batching avoids one full clear-and-replay rebuild per joint per
   * frame (see editGeometryOps's own doc comment).
   */
  function solveIKChainToTarget(targetX: number, targetY: number) {
    if (!ikChain || ikChain.length === 0) return;
    const ops = getCurrentGeometryState(graph, listIds).ops;
    const opById = new Map(ops.map((op) => [op.id, op]));
    const firstJoint = opById.get(ikChain[0] as string) as GeometryOpRotation | undefined;
    if (!firstJoint) return;
    const basePoint = graph.get<PointRecord>(pointCellId(firstJoint.source));
    const joints: IKJointSpec[] = [];
    for (const opId of ikChain) {
      const op = opById.get(opId) as GeometryOpRotation | undefined;
      if (!op) return; // a joint no longer exists (deleted) -- bail rather than solve a stale/partial chain
      joints.push({ opId, center: graph.get<PointRecord>(pointCellId(op.center)), angleDegrees: op.angleDegrees });
    }
    const solvedAngles = solveIKChainCCD(basePoint, joints, { x: targetX, y: targetY });
    editGeometryOps(
      graph,
      listIds,
      joints.map((joint, i) => ({ opId: joint.opId, patch: { angleDegrees: solvedAngles[i] as number } })),
    );
  }

  function handlePointerDown(e: PointerEvent<HTMLCanvasElement>) {
    const { x, y } = dataCoordsFromEvent(e);
    const freeHit = nearestPointId(graph, listIds, x, y, currentHitDataRadius(), true);
    if (freeHit) {
      const { sx, sy } = canvasEventPoint(e, e.currentTarget, WIDTH, HEIGHT);
      dragRef.current = { id: freeHit, moved: false, startSx: sx, startSy: sy, kind: "free" };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    // #336 item 6: the chain's end-effector point is otherwise a plain
    // dependent (non-free) point, normally excluded from dragging entirely
    // -- this is the one deliberate exception, and only while a chain is
    // actively designated.
    if (ikChain && ikChain.length > 0) {
      const endEffectorId = ikChain[ikChain.length - 1] as string;
      if (graph.has(pointCellId(endEffectorId))) {
        const p = graph.get<PointRecord>(pointCellId(endEffectorId));
        if (Math.hypot(p.x - x, p.y - y) <= currentHitDataRadius()) {
          const { sx, sy } = canvasEventPoint(e, e.currentTarget, WIDTH, HEIGHT);
          dragRef.current = { id: endEffectorId, moved: false, startSx: sx, startSy: sy, kind: "solve" };
          e.currentTarget.setPointerCapture(e.pointerId);
          return;
        }
      }
    }
    // An anchored point is otherwise a plain dependent point too, same
    // deliberate exception as the IK end effector above -- but this one
    // always works, regardless of any tool or designated chain, since an
    // anchor's whole point is being draggable along its constraint.
    const anchorHit = nearestAnchorPointId(graph, listIds, x, y, currentHitDataRadius());
    if (anchorHit) {
      const { sx, sy } = canvasEventPoint(e, e.currentTarget, WIDTH, HEIGHT);
      dragRef.current = { id: anchorHit, moved: false, startSx: sx, startSy: sy, kind: "anchor" };
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  }

  // A press only becomes a DRAG after the pointer travels this far in
  // screen pixels (mallory-graph#305 bug 3): real mice jitter a pixel or
  // two between press and release, and without a threshold every click on
  // a point counted as a "drag" -- so handlePointerUp's !moved check never
  // fired, tool selections (line/circle/reflect/...) never registered, and
  // the point relocated by the jitter instead. 4px matches the slop
  // budget pointer UIs conventionally use.
  const DRAG_THRESHOLD_PX = 4;

  function handlePointerMove(e: PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    if (!drag.moved) {
      const { sx, sy } = canvasEventPoint(e, e.currentTarget, WIDTH, HEIGHT);
      if (Math.hypot(sx - drag.startSx, sy - drag.startSy) < DRAG_THRESHOLD_PX) return;
      drag.moved = true;
    }
    const { x, y } = dataCoordsFromEvent(e);
    if (drag.kind === "solve") solveIKChainToTarget(x, y);
    else if (drag.kind === "anchor") dragAnchorToTarget(drag.id, x, y);
    else graph.set(pointCellId(drag.id), { x, y });
  }

  /** Re-solves an anchored point's `param` from the drag cursor's position, via the same clear-and-replay `editGeometryOp` uses -- so it's undoable for free, same as every other op edit. */
  function dragAnchorToTarget(anchorId: string, x: number, y: number) {
    const op = getCurrentGeometryState(graph, listIds).ops.find((o) => o.id === anchorId);
    if (!op || op.tool !== "anchor") return; // the target (or the anchor itself) was deleted mid-drag
    if (!graph.has(circleCellId(op.target)) && !graph.has(lineCellId(op.target))) return;
    editGeometryOp(graph, listIds, anchorId, { param: anchorParamForPosition(graph, op.target, x, y) } as Partial<GeometryOp>);
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
    if (tool === "select") {
      // #336 item 1: the broader hit test (lines/circles/polygons, not just
      // points) is scoped to this branch only -- every other tool's click
      // handling only ever needs point hits.
      const hit = nearestObjectId(graph, listIds, x, y, currentHitDataRadius());
      if (hit) toggleSelected(hit);
      else setSelected(new Set()); // empty click clears the selection
      return;
    }
    if (tool === "anchor") {
      const target = nearestCircleOrLineId(graph, listIds, x, y, currentHitDataRadius());
      if (target) addAnchor(graph, listIds, target, anchorParamForPosition(graph, target, x, y));
      // a miss (empty space, or a point/polygon) is a no-op -- an anchor needs a circle or line to attach to
      return;
    }
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
  const ikEndEffectorId = ikChain && ikChain.length > 0 ? (ikChain[ikChain.length - 1] as string) : null;

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const redraw = () =>
      drawGeometryPanel(ctx, WIDTH, HEIGHT, graph, listIds, pending, pendingAngle, pendingPolygon, angleUnit, selected, ikEndEffectorId);
    redraw();
    return graph.subscribeAll(redraw);
    // `pending`/`pendingAngle`/`pendingPolygon`/`angleUnit`/`selected`/
    // `ikEndEffectorId` aren't graph state, so they can't trigger a redraw
    // via subscribeAll -- re-running this effect (which calls redraw() once
    // immediately) on selection change (or a live angle-unit toggle, or an
    // IK chain being designated/cleared) is what keeps the canvas in sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, pending, pendingAngle, pendingPolygon, angleUnit, selected, ikEndEffectorId]);

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
        const customColor = graph.has(colorCellId(id)) ? graph.get<string>(colorCellId(id)) : null;
        layers.push({
          kind: "polyline",
          points: [pa, pb],
          color: length < DEGENERATE_EPSILON ? DEGENERATE_COLOR : (customColor ?? getThemeColors().ink),
          strokeWidth: 2,
        });
      } else if (graph.has(circleCellId(id))) {
        const { center, radiusPoint } = graph.get<CircleRecord>(circleCellId(id));
        const pc = graph.get<PointRecord>(pointCellId(center));
        const radius = graph.get<number>(radiusCellId(id));
        const customColor = graph.has(colorCellId(id)) ? graph.get<string>(colorCellId(id)) : null;
        layers.push({
          kind: "circle",
          cx: pc.x,
          cy: pc.y,
          radius,
          color: radius < DEGENERATE_EPSILON ? DEGENERATE_COLOR : (customColor ?? "#16a34a"),
          strokeWidth: 2,
        });
      } else if (graph.has(angleRecordCellId(id))) {
        const { a, vertex, c, mode } = graph.get<AngleRecord>(angleRecordCellId(id));
        const pa = graph.get<PointRecord>(pointCellId(a));
        const pv = graph.get<PointRecord>(pointCellId(vertex));
        const pc = graph.get<PointRecord>(pointCellId(c));
        const angle = graph.get<number>(angleValueCellId(id));
        layers.push(...angleExportLayers(pa, pv, pc, angle, angleUnit, mode ?? "shorter"));
      } else if (graph.has(polygonCellId(id))) {
        const { points } = graph.get<PolygonRecord>(polygonCellId(id));
        const pts = points.map((pid) => graph.get<PointRecord>(pointCellId(pid)));
        const area = graph.get<number>(areaCellId(id));
        const selfIntersecting = graph.get<boolean>(polygonSelfIntersectingCellId(id));
        const customColor = graph.has(colorCellId(id)) ? graph.get<string>(colorCellId(id)) : null;
        layers.push(...polygonExportLayers(pts, area, selfIntersecting, customColor));
      }
    }

    if (dependentPoints.length > 0) layers.push({ kind: "scatter", points: dependentPoints, color: getThemeColors().muted });
    if (freePoints.length > 0) layers.push({ kind: "scatter", points: freePoints, color: "#2563eb" });
    if (pendingPoints.length > 0) layers.push({ kind: "scatter", points: pendingPoints, color: "#dc2626" });

    return layers;
  }

  const hint =
    tool === "select"
      ? selected.size === 0
        ? "Click a point, line, circle, or polygon to select it (click again to deselect); click empty space to clear the selection."
        : `${selected.size} selected -- click to add/remove, or click empty space to clear.`
      : tool === "point"
      ? "Click empty space to place a point, or drag an existing one."
      : tool === "anchor"
      ? "Click on an existing circle or line to pin a point there -- it'll stay on that circle/line, draggable only along it."
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
      <label style={{ display: "block", margin: "0.25rem 0", fontSize: "0.85rem" }}>
        Angle unit:{" "}
        <select value={angleUnit} onChange={(e) => setAngleUnit(e.target.value === "degrees" ? "degrees" : "radians")}>
          <option value="radians">Radians</option>
          <option value="degrees">Degrees</option>
        </select>
        <span style={{ marginLeft: "0.5rem", color: "var(--muted)" }}>
          Affects measured-angle labels and the rotate tool's input here, and the Complex panel's arg() readout.
          Shared across this browser (this doesn't change how typed expressions like sin(x) are evaluated -- those
          stay radians).
        </span>
      </label>
      <div style={{ margin: "0.25rem 0", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
        {TOOL_GROUPS.map((group) => (
          <div
            key={group.label}
            role="radiogroup"
            aria-label={group.label}
            style={{
              display: "flex",
              gap: "0.5rem",
              flexWrap: "wrap",
              alignItems: "center",
              border: "1px solid var(--border)",
              borderRadius: "4px",
              padding: "0.25rem 0.5rem",
            }}
          >
            <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{group.label}:</span>
            {group.tools.map((t) => (
              <label key={t}>
                <input
                  type="radio"
                  name="geometry-tool"
                  checked={tool === t}
                  onChange={() => {
                    setTool(t);
                    setPending(null);
                    setPendingAngle([]);
                    setPendingPolygon([]);
                    if (t !== "select") setSelected(new Set());
                  }}
                />{" "}
                {t}
              </label>
            ))}
          </div>
        ))}
        {tool === "rotate" && (
          <label>
            angle ({angleUnitSuffix(angleUnit).trim() || "rad"}):{" "}
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
        <PngExportButton
          getCanvas={() => canvasRef.current}
          label="geometry"
          renderAtScale={(ctx, width, height) =>
            drawGeometryPanel(ctx, width, height, graph, listIds, pending, pendingAngle, pendingPolygon, angleUnit, selected, ikEndEffectorId)
          }
          baseWidth={WIDTH}
          baseHeight={HEIGHT}
        />
        <SvgExportButton
          getSvg={() => {
            const layers = geometryExportLayers();
            return layers.length > 0 ? layersToSvgDocument(layers, VIEWPORT, WIDTH, HEIGHT) : null;
          }}
          label="geometry"
        />
      </div>
      <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>{hint}</p>
      <SelectionControls graph={graph} listIds={listIds} selected={selected} setSelected={setSelected} />
      <IKChainControls graph={graph} listIds={listIds} selected={selected} ikChain={ikChain} setIkChain={setIkChain} />
      <TransformParamsEditor graph={graph} listIds={listIds} angleUnit={angleUnit} selected={selected} />
      <div style={{ margin: "0.5rem 0" }}>
        <AlgebraView graph={graph} />
      </div>
      {syncUrl && (
        <div style={{ margin: "0.5rem 0" }}>
          <button type="button" onClick={handleSave}>
            Save
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

/** #336 item 6: an open ring around the IK chain's end-effector point, distinguishing it from every other (non-draggable) dependent point. */
function drawIKEndEffectorRing(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const sx = toScreenX(x, VIEWPORT, WIDTH);
  const sy = toScreenY(y, VIEWPORT, HEIGHT);
  ctx.save();
  ctx.strokeStyle = "#0d9488";
  ctx.lineWidth = 2;
  ctx.setLineDash([3, 2]);
  ctx.beginPath();
  ctx.arc(sx, sy, 9, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  a: PointRecord,
  b: PointRecord,
  degenerate = false,
  customColor: string | null = null,
  selected = false,
): void {
  ctx.save();
  ctx.strokeStyle = degenerate ? DEGENERATE_COLOR : selected ? SELECTED_HIGHLIGHT_COLOR : (customColor ?? getThemeColors().ink);
  ctx.lineWidth = selected ? 3 : 2;
  ctx.beginPath();
  ctx.moveTo(toScreenX(a.x, VIEWPORT, WIDTH), toScreenY(a.y, VIEWPORT, HEIGHT));
  ctx.lineTo(toScreenX(b.x, VIEWPORT, WIDTH), toScreenY(b.y, VIEWPORT, HEIGHT));
  ctx.stroke();
  ctx.restore();
}

function drawCircle(
  ctx: CanvasRenderingContext2D,
  center: PointRecord,
  radius: number,
  degenerate = false,
  customColor: string | null = null,
  selected = false,
): void {
  const sx = toScreenX(center.x, VIEWPORT, WIDTH);
  const sy = toScreenY(center.y, VIEWPORT, HEIGHT);
  const screenRadius = (radius / (VIEWPORT.xMax - VIEWPORT.xMin)) * WIDTH;
  ctx.save();
  ctx.strokeStyle = degenerate ? DEGENERATE_COLOR : selected ? SELECTED_HIGHLIGHT_COLOR : (customColor ?? "#16a34a");
  ctx.lineWidth = selected ? 3 : 2;
  ctx.beginPath();
  ctx.arc(sx, sy, screenRadius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * A small fixed-radius arc at `vertex` sweeping between rays to `a`/`c`,
 * plus a degree-label near its midpoint. Canvas angles increase in the
 * visually-clockwise direction (screen y grows downward), so the two ray
 * angles are computed directly in screen space rather than converted from
 * data space -- arc-drawing is inherently a screen-space operation.
 * `mode` (see `AngleMode`'s own doc comment) picks which of the two
 * candidate angles `angleSweepRadians` sweeps: `endAngle = theta1 + delta`
 * with `anticlockwise = delta < 0` reproduces the arc for any delta
 * magnitude up to just under a full turn, not just the original
 * `"shorter"` mode's <=180deg case. `selected` swaps the stroke to the
 * same highlight color line/circle/polygon already use, now that angles
 * are select-tool-hittable (`distanceToAngleArc`).
 */
function drawAngle(ctx: CanvasRenderingContext2D, a: PointRecord, vertex: PointRecord, c: PointRecord, angleRadians: number, angleUnit: AngleUnit, mode: AngleMode, selected = false): void {
  const vx = toScreenX(vertex.x, VIEWPORT, WIDTH);
  const vy = toScreenY(vertex.y, VIEWPORT, HEIGHT);
  const ax = toScreenX(a.x, VIEWPORT, WIDTH);
  const ay = toScreenY(a.y, VIEWPORT, HEIGHT);
  const cx = toScreenX(c.x, VIEWPORT, WIDTH);
  const cy = toScreenY(c.y, VIEWPORT, HEIGHT);
  const theta1 = Math.atan2(ay - vy, ax - vx);
  const theta2 = Math.atan2(cy - vy, cx - vx);
  const delta = angleSweepRadians(theta1, theta2, mode);
  const anticlockwise = delta < 0;
  ctx.save();
  ctx.strokeStyle = selected ? SELECTED_HIGHLIGHT_COLOR : "#9333ea";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(vx, vy, ANGLE_ARC_RADIUS_PX, theta1, theta1 + delta, anticlockwise);
  ctx.stroke();
  const mid = theta1 + delta / 2;
  const labelX = vx + (ANGLE_ARC_RADIUS_PX + 14) * Math.cos(mid);
  const labelY = vy + (ANGLE_ARC_RADIUS_PX + 14) * Math.sin(mid);
  // getThemeColors(), not "var(--muted)" -- canvas fillStyle silently
  // ignores CSS custom properties (theme-colors.ts's own doc comment), so
  // this label was rendering in whatever color the context last used.
  ctx.fillStyle = getThemeColors().muted;
  ctx.font = "12px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(formatAngle(angleRadians, angleUnit), labelX, labelY);
  ctx.restore();
}

/** `drawAngle`'s exact theta1/theta2/delta/anticlockwise/labelX/labelY math, re-emitted as an `"arc"` + `"text"` SvgLayer pair instead of Canvas2D calls -- see that function's own doc comment for the geometry. */
function angleExportLayers(a: PointRecord, vertex: PointRecord, c: PointRecord, angleRadians: number, angleUnit: AngleUnit, mode: AngleMode): SvgLayer[] {
  const vx = toScreenX(vertex.x, VIEWPORT, WIDTH);
  const vy = toScreenY(vertex.y, VIEWPORT, HEIGHT);
  const ax = toScreenX(a.x, VIEWPORT, WIDTH);
  const ay = toScreenY(a.y, VIEWPORT, HEIGHT);
  const cx = toScreenX(c.x, VIEWPORT, WIDTH);
  const cy = toScreenY(c.y, VIEWPORT, HEIGHT);
  const theta1 = Math.atan2(ay - vy, ax - vx);
  const theta2 = Math.atan2(cy - vy, cx - vx);
  const delta = angleSweepRadians(theta1, theta2, mode);
  const anticlockwise = delta < 0;
  const mid = theta1 + delta / 2;
  const labelX = vx + (ANGLE_ARC_RADIUS_PX + 14) * Math.cos(mid);
  const labelY = vy + (ANGLE_ARC_RADIUS_PX + 14) * Math.sin(mid);
  return [
    { kind: "arc", cxPx: vx, cyPx: vy, radiusPx: ANGLE_ARC_RADIUS_PX, startAngle: theta1, endAngle: theta1 + delta, anticlockwise, color: "#9333ea", strokeWidth: 1.5 },
    { kind: "text", xPx: labelX, yPx: labelY, label: formatAngle(angleRadians, angleUnit) },
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
function drawPolygon(
  ctx: CanvasRenderingContext2D,
  points: PointRecord[],
  area: number,
  selfIntersecting: boolean,
  customColor: string | null = null,
  selected = false,
): void {
  if (points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = selfIntersecting ? DEGENERATE_COLOR : selected ? SELECTED_HIGHLIGHT_COLOR : (customColor ?? "#0891b2");
  ctx.lineWidth = selected ? 3 : 2;
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
  ctx.fillStyle = selfIntersecting ? DEGENERATE_COLOR : getThemeColors().muted;
  ctx.font = "12px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const label = selfIntersecting ? `${area.toFixed(2)} (self-intersecting)` : area.toFixed(2);
  ctx.fillText(label, toScreenX(centroid.x, VIEWPORT, WIDTH), toScreenY(centroid.y, VIEWPORT, HEIGHT));
  ctx.restore();
}

/** `drawPolygon`'s exact closed-loop + centroid-label logic, re-emitted as a closed `"polyline"` + `"text"` SvgLayer pair instead of Canvas2D calls -- the polyline is closed by re-appending the first point (mirroring `ctx.closePath()`), since `"polyline"` never auto-closes the way Canvas2D paths do. */
function polygonExportLayers(points: PointRecord[], area: number, selfIntersecting: boolean, customColor: string | null = null): SvgLayer[] {
  if (points.length < 2) return [];
  const first = points[0] as PointRecord;
  const centroid = polygonCentroid(points);
  const label = selfIntersecting ? `${area.toFixed(2)} (self-intersecting)` : area.toFixed(2);
  return [
    { kind: "polyline", points: [...points, first], color: selfIntersecting ? DEGENERATE_COLOR : (customColor ?? "#0891b2"), strokeWidth: 2 },
    {
      kind: "text",
      xPx: toScreenX(centroid.x, VIEWPORT, WIDTH),
      yPx: toScreenY(centroid.y, VIEWPORT, HEIGHT),
      label,
      color: selfIntersecting ? DEGENERATE_COLOR : undefined,
    },
  ];
}
