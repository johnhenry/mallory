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
import type { Mesh, Path2D } from "mallory-math";
import { ComplexNumber, Symbolic } from "mallory-math";
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useModelContextTool } from "../hooks/use-model-context-tool.ts";
import { useNonPassiveWheel } from "../hooks/use-non-passive-wheel.ts";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsOmnigraph, cellIdsOmnigraphRow, type CellIdsOmnigraph } from "../lib/cell-ids.ts";
import { evaluateComplex, type ComplexEnv } from "../lib/complex-eval.ts";
import { renderDomainColoring } from "../lib/complex-raster.ts";
import { equationToImplicitZero } from "../lib/equation-to-zero.ts";
import { preprocessImplicitMultiplication } from "../lib/implicit-mult.ts";
import { meshToGeometry, meshToMaterial } from "../lib/mesh-to-geometry.ts";
import { appendRow, paletteColor, removeRow } from "../lib/multi-panel-rows.ts";
import { OMNIGRAPH_ITEM_TYPES, defaultOmnigraphItem, omnigraphIs3D, readOmnigraphItem, seedOmnigraphRow } from "../lib/omnigraph-items.ts";
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
import { sampleParametricSurface } from "../lib/sample-parametric-surface.ts";
import { sampleSpaceCurve, type SpaceCurvePoint } from "../lib/sample-space-curve.ts";
import { sampleSurface } from "../lib/sample-surface.ts";
import { sampleVectorField3D, type VectorField3DPoint } from "../lib/sample-vector-field-3d.ts";
import { createThreeScene, disposeGroup, planePointToThree, toThreePoint, type ThreeSceneHandle } from "../lib/three-scene.ts";
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

// 3D sampling constants, matching each source panel's own values (the
// domains are fixed -5..5 like Graph3DCanvas/VectorField3DPanel rather
// than viewport-driven -- OrbitControls owns 3D navigation, and the 2D
// viewport cell keeps meaning "the 2D items' sampling window").
const SURFACE_DOMAIN = { min: -5, max: 5 };
const SURFACE_RESOLUTION = 40;
const PARAM_SURFACE_RESOLUTION = 30;
const SPACE_CURVE_RESOLUTION = 300;
const VECTOR_GRID_DENSITY = 5;
const MAX_ARROW_LENGTH = 0.8;
const TUBE_RADIUS = 0.05;
const TUBE_RADIAL_SEGMENTS = 8;
const CAMERA_DISTANCE_3D = 8;
const AXES_EXTENT_3D = 5;

type Result<T> = { ok: true; value: T } | { ok: false; message: string };

/** The item types the dropdown offers TODAY -- phases 1 (2D core) and 2 (3D core) are live; phase 3's exotic ones land next. The state codec already understands all 11 (see omnigraph-state.ts's own doc comment). */
const AVAILABLE_TYPES = (Object.keys(OMNIGRAPH_ITEM_TYPES) as OmnigraphItemType[]).filter((t) => OMNIGRAPH_ITEM_TYPES[t].phase <= 2);

/**
 * One item's drawable form, derived per row by the `graph.define`d cell
 * below (so it recomputes reactively, and errors surface per row instead
 * of killing the whole redraw). The complex variant carries the compiled
 * evaluator, not pixels -- rasterization happens at draw time because it
 * depends on the viewport, which pans/zooms without touching the row.
 * The 3D variants carry sampler output in each sampler's own convention;
 * the axis-swap to Three's y-up world happens in the rebuild effect via
 * three-scene.ts's `toThreePoint` (surfaces skip it -- `meshToGeometry`
 * already swaps).
 */
type Drawable =
  | { kind: "path"; path: Path2D }
  | { kind: "segments"; segments: ImplicitSegment[]; expr: string }
  | { kind: "raster"; f: (z: ComplexNumber) => ComplexNumber }
  | { kind: "mesh"; meshes: Mesh[] }
  | { kind: "points3d"; points: SpaceCurvePoint[] }
  | { kind: "field3d"; points: VectorField3DPoint[] };

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
        case "surface": {
          const color = graph.get<number>(ids.color);
          const meshes = sampleSurface(graph.get<string>(ids.expr), SURFACE_DOMAIN, SURFACE_DOMAIN, SURFACE_RESOLUTION, {}, color);
          return { ok: true, value: { kind: "mesh", meshes } };
        }
        case "parametricSurface": {
          const uDomain = { min: bound(graph.get<string>(ids.uMin), "u-min"), max: bound(graph.get<string>(ids.uMax), "u-max") };
          const vDomain = { min: bound(graph.get<string>(ids.vMin), "v-min"), max: bound(graph.get<string>(ids.vMax), "v-max") };
          if (uDomain.min >= uDomain.max) throw new Error("u-min must be less than u-max.");
          if (vDomain.min >= vDomain.max) throw new Error("v-min must be less than v-max.");
          const color = graph.get<number>(ids.color);
          const meshes = sampleParametricSurface(
            graph.get<string>(ids.exprA),
            graph.get<string>(ids.exprB),
            graph.get<string>(ids.exprC),
            uDomain,
            vDomain,
            PARAM_SURFACE_RESOLUTION,
            {},
            color,
          );
          return { ok: true, value: { kind: "mesh", meshes } };
        }
        case "spaceCurve": {
          const domain = { min: bound(graph.get<string>(ids.tMin), "t-min"), max: bound(graph.get<string>(ids.tMax), "t-max") };
          if (domain.min >= domain.max) throw new Error("t-min must be less than t-max.");
          const points = sampleSpaceCurve(graph.get<string>(ids.exprA), graph.get<string>(ids.exprB), graph.get<string>(ids.exprC), domain, SPACE_CURVE_RESOLUTION);
          return { ok: true, value: { kind: "points3d", points } };
        }
        case "vectorField3d": {
          const points = sampleVectorField3D(
            graph.get<string>(ids.exprA),
            graph.get<string>(ids.exprB),
            graph.get<string>(ids.exprC),
            SURFACE_DOMAIN,
            SURFACE_DOMAIN,
            SURFACE_DOMAIN,
            VECTOR_GRID_DENSITY,
          );
          return { ok: true, value: { kind: "field3d", points } };
        }
        default:
          throw new Error(`Item type "${type}" isn't available on this surface yet (a later phase adds it).`);
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

/** True when any row's current type is 3D -- read straight off the cells (not via readOmnigraphItem, which materializes whole items) so the mode-watch effect stays cheap. */
function currentIs3D(graph: CellGraph, containerIds: CellIdsOmnigraph): boolean {
  const items: Array<{ type: OmnigraphItemType }> = [];
  for (const rowId of graph.get<string[]>(containerIds.list)) {
    const ids = cellIdsOmnigraphRow(rowId);
    if (graph.hasValue(ids.type)) items.push({ type: graph.get<OmnigraphItemType>(ids.type) });
  }
  return omnigraphIs3D(items);
}

/**
 * Builds one row's Three.js object for the 3D scene, dispatching on its
 * derived drawable -- the generalization of GradientDescentPanel's
 * hardcoded surface+path groups and ComplexGraph3DPanel's per-row
 * curve/scatter dispatch. Returns null for hidden/errored rows and for
 * types with no 3D representation yet (complex rasters until phase 3).
 * Every point-producing type goes through three-scene.ts's adapters --
 * see toThreePoint's own convention table.
 */
function buildRowObject3D(graph: CellGraph, rowId: string): THREE.Object3D | null {
  const ids = cellIdsOmnigraphRow(rowId);
  if (!graph.hasValue(ids.type) || !graph.get<boolean>(ids.visible)) return null;
  const drawable = graph.get<Result<Drawable>>(ids.error);
  if (!drawable.ok) return null;
  const d = drawable.value;
  const color = graph.hasValue(ids.color) ? graph.get<number>(ids.color) : 0x2563eb;

  switch (d.kind) {
    case "mesh": {
      const group = new THREE.Group();
      for (const mesh of d.meshes) group.add(new THREE.Mesh(meshToGeometry(mesh), meshToMaterial(mesh)));
      return group;
    }
    case "points3d": {
      const vectors = d.points.map(toThreePoint);
      if (vectors.length < 2) return null;
      const curve = new THREE.CatmullRomCurve3(vectors);
      const geometry = new THREE.TubeGeometry(curve, Math.max(2, vectors.length), TUBE_RADIUS, TUBE_RADIAL_SEGMENTS, false);
      return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color }));
    }
    case "field3d": {
      const group = new THREE.Group();
      const maxMagnitude = Math.max(1e-9, ...d.points.map((p) => Math.hypot(p.dx, p.dy, p.dz)));
      for (const point of d.points) {
        const magnitude = Math.hypot(point.dx, point.dy, point.dz);
        if (magnitude < 1e-9) continue;
        // Both position AND direction go through the axis swap (the
        // direction is a displacement, so it swaps the same way).
        const dir = toThreePoint({ x: point.dx, y: point.dy, z: point.dz }).normalize();
        const origin = toThreePoint(point);
        const length = (magnitude / maxMagnitude) * MAX_ARROW_LENGTH;
        group.add(new THREE.ArrowHelper(dir, origin, length, color, length * 0.3, length * 0.2));
      }
      return group;
    }
    case "path": {
      // A 2D curve drawn flat on the ground plane: split the Path2D's
      // command list into runs at moveTo boundaries (each run is one
      // continuous branch; discontinuities/asymptotes stay gaps).
      const group = new THREE.Group();
      const material = new THREE.LineBasicMaterial({ color });
      let run: THREE.Vector3[] = [];
      const flush = () => {
        if (run.length >= 2) group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(run), material));
        run = [];
      };
      for (const cmd of d.path.commands) {
        if (cmd.op === "moveTo") flush();
        run.push(planePointToThree(cmd));
      }
      flush();
      return group.children.length > 0 ? group : null;
    }
    case "segments": {
      // Implicit marching-squares segments as one merged LineSegments --
      // pairs of points, no connectivity between segments.
      if (d.segments.length === 0) return null;
      const points: THREE.Vector3[] = [];
      for (const s of d.segments) {
        points.push(planePointToThree({ x: s.x1, y: s.y1 }), planePointToThree({ x: s.x2, y: s.y2 }));
      }
      return new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color }));
    }
    case "raster":
      // Complex domain coloring's 3D form (textured ground plane) is
      // phase 3 -- until then the item simply doesn't render in 3D mode
      // (its row stays in the list, unchanged).
      return null;
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
            <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>renders as a background layer (2D surface only for now)</span>
          </>
        )}
        {type === "surface" && field(ids.expr, "z(x, y) =", "20ch")}
        {type === "parametricSurface" && (
          <>
            {field(ids.exprA, "x(u,v) =")}
            {field(ids.exprB, "y(u,v) =")}
            {field(ids.exprC, "z(u,v) =")}
            {field(ids.uMin, "u ∈ [", "6ch")}
            {field(ids.uMax, ",", "6ch")}
            {field(ids.vMin, "v ∈ [", "6ch")}
            {field(ids.vMax, ",", "6ch")}
          </>
        )}
        {type === "spaceCurve" && (
          <>
            {field(ids.exprA, "x(t) =")}
            {field(ids.exprB, "y(t) =")}
            {field(ids.exprC, "z(t) =")}
            {field(ids.tMin, "t ∈ [", "6ch")}
            {field(ids.tMax, ",", "6ch")}
          </>
        )}
        {type === "vectorField3d" && (
          <>
            {field(ids.exprA, "dx =")}
            {field(ids.exprB, "dy =")}
            {field(ids.exprC, "dz =")}
            <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>sampled on a 5×5×5 grid over [-5, 5]³</span>
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

  // The surface's own 2D-vs-3D mode: 3D iff any 3D-type item EXISTS
  // (visible or not -- an eye-toggle never tears the scene down; deleting
  // the last 3D item downgrades back to the 2D canvas). Watched via
  // subscribeAll rather than per-row hooks since a type switch changes no
  // row-list identity, only a row's own type cell.
  const [is3D, setIs3D] = useState(() => currentIs3D(graph, containerIds));
  useEffect(() => {
    const update = () => setIs3D(currentIs3D(graph, containerIds));
    update();
    return graph.subscribeAll(update);
  }, [graph, containerIds]);

  const threeContainerRef = useRef<HTMLDivElement | null>(null);
  const threeHandleRef = useRef<ThreeSceneHandle | null>(null);
  const [glError, setGlError] = useState<string | null>(null);

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

  // Single 2D redraw effect over subscribeAll -- dynamic row count, same
  // reasoning as every other multi-row panel. `is3D` in the deps so the
  // effect re-attaches to the freshly-remounted canvas when the surface
  // downgrades from 3D back to 2D (the canvas element is unmounted while
  // in 3D mode, so the previous ctx is gone).
  useEffect(() => {
    if (is3D) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    if (!previewCanvasRef.current && typeof document !== "undefined") previewCanvasRef.current = document.createElement("canvas");
    const redraw = () => drawOmnigraph2D(ctx, WIDTH, HEIGHT, graph, containerIds, previewCanvasRef.current ?? undefined);
    redraw();
    return graph.subscribeAll(redraw);
  }, [graph, containerIds, is3D]);

  // 3D scene lifecycle: created lazily on first upgrade, disposed fully
  // (including forceContextLoss -- see createThreeScene's own doc comment
  // on the browser WebGL context cap) on downgrade/unmount. One rebuild
  // effect generalizes GradientDescentPanel/ComplexGraph3DPanel's per-row
  // dispatch: dispose + rebuild every row's object on any graph change.
  useEffect(() => {
    if (!is3D) return;
    const container = threeContainerRef.current;
    if (!container) return;
    let handle: ThreeSceneHandle;
    try {
      handle = createThreeScene(container, { width: WIDTH, height: HEIGHT, cameraDistance: CAMERA_DISTANCE_3D, axesExtent: AXES_EXTENT_3D });
    } catch (e) {
      // WebGL unavailable (headless/test environments, GL-disabled
      // browsers): degrade to a message instead of crashing the panel --
      // the item list and 2D-mode path stay fully usable.
      setGlError(e instanceof Error ? e.message : String(e));
      return;
    }
    setGlError(null);
    const content = new THREE.Group();
    handle.scene.add(content);
    threeHandleRef.current = handle;

    const rebuild = () => {
      disposeGroup(content);
      for (const rowId of graph.get<string[]>(containerIds.list)) {
        try {
          const object = buildRowObject3D(graph, rowId);
          if (object) content.add(object);
        } catch {
          // Row mid-removal -- skip it this pass.
        }
      }
    };
    rebuild();
    const unsubscribe = graph.subscribeAll(rebuild);
    handle.start();

    return () => {
      unsubscribe();
      disposeGroup(content);
      handle.dispose();
      threeHandleRef.current = null;
    };
  }, [is3D, graph, containerIds]);

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
        Every graph type on one surface: add items and pick each one's type from its dropdown. The surface upgrades to a 3D scene when any
        3D-type item exists (2D items then draw flat on the ground plane); delete the 3D items to return to the 2D canvas.
        Complex-coloring items render as background layers in list order (2D surface only for now).
      </p>
      {rowIds.map((rowId) => (
        <OmnigraphRow key={rowId} graph={graph} rowId={rowId} containerIds={containerIds} onRemove={rowIds.length > 1 ? () => removeItem(rowId) : undefined} />
      ))}
      <button type="button" onClick={() => addItem()} style={{ margin: "0.35rem 0" }}>
        + Add item
      </button>
      {is3D ? (
        <>
          <div ref={threeContainerRef} style={{ position: "relative", maxWidth: WIDTH, border: "1px solid var(--border)" }} />
          {glError && (
            <p style={{ color: "var(--danger)", fontSize: "0.8rem" }}>3D scene unavailable (WebGL failed to initialize): {glError}</p>
          )}
        </>
      ) : (
        <canvas
          ref={canvasRef}
          width={WIDTH}
          height={HEIGHT}
          style={{ border: "1px solid var(--border)", touchAction: "none", maxWidth: "100%" }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
      )}
      <div style={{ margin: "0.25rem 0" }}>
        {is3D ? (
          <PngExportButton getCanvas={() => threeHandleRef.current?.getCanvas() ?? null} label="omnigraph-3d" />
        ) : (
          <PngExportButton
            getCanvas={() => canvasRef.current}
            label="omnigraph"
            renderAtScale={(ctx, width, height) => drawOmnigraph2D(ctx, width, height, graph, containerIds)}
            baseWidth={WIDTH}
            baseHeight={HEIGHT}
          />
        )}{" "}
        {!is3D && (
          <button type="button" onClick={resetView}>
            Reset view
          </button>
        )}
      </div>
      {is3D ? (
        <p style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
          3D mode: drag to orbit, scroll to zoom. 2D items draw flat on the ground plane, sampled over the last committed 2D viewport (x ∈ [
          {committedViewport.xMin.toFixed(2)}, {committedViewport.xMax.toFixed(2)}], y ∈ [{committedViewport.yMin.toFixed(2)},{" "}
          {committedViewport.yMax.toFixed(2)}]).
        </p>
      ) : (
        <p style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
          Viewport: x ∈ [{viewport.xMin.toFixed(2)}, {viewport.xMax.toFixed(2)}], y ∈ [{viewport.yMin.toFixed(2)}, {viewport.yMax.toFixed(2)}]
        </p>
      )}
    </div>
  );
}
