/**
 * Omnigraph item metadata + CellGraph seed/read helpers -- the pure,
 * unit-testable bridge between omnigraph-state.ts's serialized item union
 * and cell-ids.ts's wide per-row cell bag. Shared by the panel's URL-sync
 * effect (cells -> state) and its render dispatch (cells -> draw), so the
 * two can never disagree about what a row means.
 */
import type { CellGraph } from "./cell-graph.ts";
import { cellIdsOmnigraphRow } from "./cell-ids.ts";
import type { AxisChoice } from "./sample-complex-graph.ts";
import type { OmnigraphItem, OmnigraphItemType } from "./omnigraph-state.ts";

/**
 * Dropdown order + per-type metadata. `is3D` drives the surface's own
 * 2D-vs-3D mode: the panel renders the Three.js scene iff any item of an
 * `is3D` type EXISTS (visible or not -- existence, not visibility, so
 * toggling an eye icon never tears the scene down). `phase` gates which
 * types the dropdown actually offers while later phases land -- the state
 * codec understands all 11 from day one (see omnigraph-state.ts), the UI
 * grows into them.
 */
export const OMNIGRAPH_ITEM_TYPES: Record<OmnigraphItemType, { label: string; is3D: boolean; phase: 1 | 2 | 3 }> = {
  expression: { label: "Expression y=f(x)", is3D: false, phase: 1 },
  parametric: { label: "Parametric curve", is3D: false, phase: 1 },
  polar: { label: "Polar curve", is3D: false, phase: 1 },
  implicit: { label: "Implicit equation", is3D: false, phase: 1 },
  complex: { label: "Complex coloring f(z)", is3D: false, phase: 1 },
  surface: { label: "Surface z=f(x,y)", is3D: true, phase: 2 },
  parametricSurface: { label: "Parametric surface", is3D: true, phase: 2 },
  spaceCurve: { label: "Space curve", is3D: true, phase: 2 },
  vectorField3d: { label: "Vector field 3D", is3D: true, phase: 2 },
  complexGraph3d: { label: "Complex graph 3D", is3D: true, phase: 3 },
  gradientDescent: { label: "Gradient descent", is3D: true, phase: 3 },
};

const TWO_PI_STR = (2 * Math.PI).toFixed(4);

/**
 * A ready-to-graph default for each type (defaults chosen to match the
 * source panels' own: sin(x), a Lissajous curve, a cardioid, a circle,
 * z^2, sin(x)cos(y), the torus preset, the helix preset, a rotational
 * field, x^2 on split axes, and a paraboloid bowl descent).
 */
export function defaultOmnigraphItem(type: OmnigraphItemType, color: number): OmnigraphItem {
  switch (type) {
    case "expression":
      return { type, expr: "sin(x)", color, visible: true };
    case "parametric":
      return { type, exprA: "cos(3*t)", exprB: "sin(2*t)", tMin: "0", tMax: TWO_PI_STR, color, visible: true };
    case "polar":
      return { type, exprA: "1+cos(t)", tMin: "0", tMax: TWO_PI_STR, color, visible: true };
    case "implicit":
      return { type, expr: "x^2+y^2=4", color, visible: true };
    case "complex":
      return { type, expr: "z^2", visible: true };
    case "surface":
      return { type, expr: "sin(x)*cos(y)", color, visible: true };
    case "parametricSurface":
      return {
        type,
        exprA: "(2+cos(v))*cos(u)",
        exprB: "(2+cos(v))*sin(u)",
        exprC: "sin(v)",
        uMin: "0",
        uMax: TWO_PI_STR,
        vMin: "0",
        vMax: TWO_PI_STR,
        color,
        visible: true,
      };
    case "spaceCurve":
      return { type, exprA: "cos(t)", exprB: "sin(t)", exprC: "0.15*t", tMin: "0", tMax: (4 * Math.PI).toFixed(4), color, visible: true };
    case "vectorField3d":
      return { type, exprA: "-y", exprB: "x", exprC: "0.2*z", color, visible: true };
    case "complexGraph3d":
      return {
        type,
        expr: "x^2",
        axisX: "reX",
        axisY: "reY",
        axisZ: "imY",
        tMin: "-2",
        tMax: "2",
        sweepReX: true,
        sweepImX: false,
        highlightNearReal: false,
        color,
        visible: true,
      };
    case "gradientDescent":
      return { type, expr: "x^2+y^2", startX: "3", startY: "-2", stepSize: "0.1", steps: "100", color, visible: true };
  }
}

/**
 * Writes an item's fields into its row's cells. Only the fields the
 * item's own type carries are seeded -- the wide bag's other fields stay
 * nonexistent (see cellIdsOmnigraphRow's doc comment). Always clears
 * `error`. Callable both for a fresh row and for a type SWITCH on an
 * existing row (set-over semantics just overwrite; stale fields from the
 * previous type are harmless leftovers that readOmnigraphItem never
 * reads, and removeRow still deletes them at removal).
 */
export function seedOmnigraphRow(graph: CellGraph, rowId: string, item: OmnigraphItem): void {
  const ids = cellIdsOmnigraphRow(rowId);
  graph.set(ids.type, item.type);
  graph.set(ids.visible, item.visible);
  graph.set(ids.error, "", { auxiliary: true });
  if (item.type !== "complex") graph.set(ids.color, item.color);
  switch (item.type) {
    case "expression":
    case "implicit":
    case "surface":
      graph.set(ids.expr, item.expr);
      break;
    case "complex":
      graph.set(ids.expr, item.expr);
      break;
    case "parametric":
      graph.set(ids.exprA, item.exprA);
      graph.set(ids.exprB, item.exprB);
      graph.set(ids.tMin, item.tMin);
      graph.set(ids.tMax, item.tMax);
      break;
    case "polar":
      graph.set(ids.exprA, item.exprA);
      graph.set(ids.tMin, item.tMin);
      graph.set(ids.tMax, item.tMax);
      break;
    case "parametricSurface":
      graph.set(ids.exprA, item.exprA);
      graph.set(ids.exprB, item.exprB);
      graph.set(ids.exprC, item.exprC);
      graph.set(ids.uMin, item.uMin);
      graph.set(ids.uMax, item.uMax);
      graph.set(ids.vMin, item.vMin);
      graph.set(ids.vMax, item.vMax);
      break;
    case "spaceCurve":
      graph.set(ids.exprA, item.exprA);
      graph.set(ids.exprB, item.exprB);
      graph.set(ids.exprC, item.exprC);
      graph.set(ids.tMin, item.tMin);
      graph.set(ids.tMax, item.tMax);
      break;
    case "vectorField3d":
      graph.set(ids.exprA, item.exprA);
      graph.set(ids.exprB, item.exprB);
      graph.set(ids.exprC, item.exprC);
      break;
    case "complexGraph3d":
      graph.set(ids.expr, item.expr);
      graph.set(ids.axisX, item.axisX);
      graph.set(ids.axisY, item.axisY);
      graph.set(ids.axisZ, item.axisZ);
      graph.set(ids.tMin, item.tMin);
      graph.set(ids.tMax, item.tMax);
      graph.set(ids.sweepReX, item.sweepReX);
      graph.set(ids.sweepImX, item.sweepImX);
      graph.set(ids.highlightNearReal, item.highlightNearReal);
      break;
    case "gradientDescent":
      graph.set(ids.expr, item.expr);
      graph.set(ids.startX, item.startX);
      graph.set(ids.startY, item.startY);
      graph.set(ids.stepSize, item.stepSize);
      graph.set(ids.steps, item.steps);
      break;
  }
}

function str(graph: CellGraph, id: string, fallback = ""): string {
  return graph.hasValue(id) ? graph.get<string>(id) : fallback;
}
function bool(graph: CellGraph, id: string, fallback: boolean): boolean {
  return graph.hasValue(id) ? graph.get<boolean>(id) : fallback;
}
function num(graph: CellGraph, id: string, fallback: number): number {
  return graph.hasValue(id) ? graph.get<number>(id) : fallback;
}

/**
 * Reads a row's cells back into a serializable item, or null when the row
 * has no recognizable type (mid-removal, or a cell bag that was never
 * seeded). The inverse of {@link seedOmnigraphRow}; the URL-sync effect
 * maps this over the list cell.
 */
export function readOmnigraphItem(graph: CellGraph, rowId: string): OmnigraphItem | null {
  const ids = cellIdsOmnigraphRow(rowId);
  if (!graph.hasValue(ids.type)) return null;
  const type = graph.get<OmnigraphItemType>(ids.type);
  if (!(type in OMNIGRAPH_ITEM_TYPES)) return null;
  const visible = bool(graph, ids.visible, true);
  const color = num(graph, ids.color, 0x2563eb);
  switch (type) {
    case "expression":
    case "implicit":
    case "surface":
      return { type, expr: str(graph, ids.expr), color, visible };
    case "complex":
      return { type, expr: str(graph, ids.expr), visible };
    case "parametric":
      return { type, exprA: str(graph, ids.exprA), exprB: str(graph, ids.exprB), tMin: str(graph, ids.tMin), tMax: str(graph, ids.tMax), color, visible };
    case "polar":
      return { type, exprA: str(graph, ids.exprA), tMin: str(graph, ids.tMin), tMax: str(graph, ids.tMax), color, visible };
    case "parametricSurface":
      return {
        type,
        exprA: str(graph, ids.exprA),
        exprB: str(graph, ids.exprB),
        exprC: str(graph, ids.exprC),
        uMin: str(graph, ids.uMin),
        uMax: str(graph, ids.uMax),
        vMin: str(graph, ids.vMin),
        vMax: str(graph, ids.vMax),
        color,
        visible,
      };
    case "spaceCurve":
      return {
        type,
        exprA: str(graph, ids.exprA),
        exprB: str(graph, ids.exprB),
        exprC: str(graph, ids.exprC),
        tMin: str(graph, ids.tMin),
        tMax: str(graph, ids.tMax),
        color,
        visible,
      };
    case "vectorField3d":
      return { type, exprA: str(graph, ids.exprA), exprB: str(graph, ids.exprB), exprC: str(graph, ids.exprC), color, visible };
    case "complexGraph3d":
      return {
        type,
        expr: str(graph, ids.expr),
        axisX: (graph.hasValue(ids.axisX) ? graph.get<AxisChoice>(ids.axisX) : "reX") as AxisChoice,
        axisY: (graph.hasValue(ids.axisY) ? graph.get<AxisChoice>(ids.axisY) : "reY") as AxisChoice,
        axisZ: (graph.hasValue(ids.axisZ) ? graph.get<AxisChoice>(ids.axisZ) : "imY") as AxisChoice,
        tMin: str(graph, ids.tMin),
        tMax: str(graph, ids.tMax),
        sweepReX: bool(graph, ids.sweepReX, true),
        sweepImX: bool(graph, ids.sweepImX, false),
        highlightNearReal: bool(graph, ids.highlightNearReal, false),
        color,
        visible,
      };
    case "gradientDescent":
      return {
        type,
        expr: str(graph, ids.expr),
        startX: str(graph, ids.startX),
        startY: str(graph, ids.startY),
        stepSize: str(graph, ids.stepSize),
        steps: str(graph, ids.steps),
        color,
        visible,
      };
  }
}

/** True when any item is of a 3D type -- existence, not visibility, per OMNIGRAPH_ITEM_TYPES's own doc comment. Drives the surface's 2D-vs-3D mode. */
export function omnigraphIs3D(items: ReadonlyArray<Pick<OmnigraphItem, "type">>): boolean {
  return items.some((item) => OMNIGRAPH_ITEM_TYPES[item.type].is3D);
}
