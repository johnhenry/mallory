import type { Path2D } from "mallory-math";
import { addLocalSave } from "../lib/local-saves.ts";
import { useEffect, useRef, useState } from "react";
import { CellGraph } from "../lib/cell-graph.ts";
import { useServerFn } from "@tanstack/react-start";
import { cellIdsOde, type CellIdsOde } from "../lib/cell-ids.ts";
import { renderOdePreviewFrame, startOdeExportJob } from "../lib/export-ode-video.ts";
import { ExportPreviewScrubber } from "./ExportPreviewScrubber.tsx";
import { VideoExportControls } from "./VideoExportControls.tsx";
import { drawAxes, drawPath, drawSlopeField, type Viewport } from "../lib/render-path.ts";
import { attemptOdeClosedForm, type OdeClosedFormAttempt, sampleOdeSolution, sampleSlopeField, type SlopeFieldPoint } from "../lib/sample-ode.ts";
import { DEFAULT_ODE_STATE, decodeOdeState, encodeOdeState, type OdeRowState, type OdeState } from "../lib/ode-state.ts";
import { layersToSvgDocument, type SvgLayer } from "../lib/svg-export.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useUndoHistory } from "../hooks/use-undo-history.ts";
import { appendRow, paletteColor, removeRow } from "../lib/multi-panel-rows.ts";
import { useCell } from "../lib/use-cell.ts";
import { CopyableTex } from "./CopyableTex.tsx";
import { PngExportButton } from "./PngExportButton.tsx";
import { SvgExportButton } from "./SvgExportButton.tsx";

type SolutionResult = { ok: true; path: Path2D } | { ok: false; message: string };
type SlopeFieldResult = { ok: true; points: SlopeFieldPoint[] } | { ok: false; message: string };

const WIDTH = 500;
const HEIGHT = 500;

/**
 * Seeds one row's own cells (#336 item 7, unlimited expressions): its own
 * expr/x0/y0, color and visibility, plus its own derived solution/slope
 * field/closed form. Reads the shared container's x/y domain live inside
 * each `define`, so panning the one shared domain recomputes every row --
 * same shape as Ode2Panel's `seedOde2Row`.
 */
export function seedOdeRow(graph: CellGraph, containerIds: CellIdsOde, rowId: string, row: OdeRowState): void {
  const ids = cellIdsOde(rowId);
  graph.set(ids.expr, row.expr);
  graph.set(ids.x0, row.x0);
  graph.set(ids.y0, row.y0);
  graph.set(ids.color, row.color);
  graph.set(ids.visible, row.visible);

  const domain = () => ({
    xMin: Number(graph.get<string>(containerIds.xMin)),
    xMax: Number(graph.get<string>(containerIds.xMax)),
    yMin: Number(graph.get<string>(containerIds.yMin)),
    yMax: Number(graph.get<string>(containerIds.yMax)),
  });

  graph.define(ids.solution, (): SolutionResult => {
    try {
      const expr = graph.get<string>(ids.expr);
      const x0 = Number(graph.get<string>(ids.x0));
      const y0 = Number(graph.get<string>(ids.y0));
      const { xMin, xMax } = domain();
      if ([x0, y0, xMin, xMax].some(Number.isNaN)) throw new Error("Every field must be a number.");
      if (xMin >= xMax) throw new Error("x-min must be less than x-max.");
      const path = sampleOdeSolution(expr, x0, y0, { min: xMin, max: xMax });
      return { ok: true, path };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });

  graph.define(ids.slopeField, (): SlopeFieldResult => {
    try {
      const expr = graph.get<string>(ids.expr);
      const { xMin, xMax, yMin, yMax } = domain();
      if ([xMin, xMax, yMin, yMax].some(Number.isNaN)) throw new Error("Every field must be a number.");
      if (xMin >= xMax || yMin >= yMax) throw new Error("min must be less than max for both x and y.");
      return { ok: true, points: sampleSlopeField(expr, { min: xMin, max: xMax }, { min: yMin, max: yMax }) };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });

  graph.define(ids.closedForm, (): OdeClosedFormAttempt => {
    const expr = graph.get<string>(ids.expr);
    const x0 = Number(graph.get<string>(ids.x0));
    const y0 = Number(graph.get<string>(ids.y0));
    if ([x0, y0].some(Number.isNaN)) return { found: false };
    return attemptOdeClosedForm(expr, x0, y0);
  });
}

function seedOdeRowDefault(graph: CellGraph, containerIds: CellIdsOde, rowId: string, index: number): void {
  seedOdeRow(graph, containerIds, rowId, { ...(DEFAULT_ODE_STATE.rows[0] as OdeRowState), color: paletteColor(index) });
}

/**
 * Full re-seed of the container: clears any existing rows (deleting their
 * cells, same "delete then replay" shape geometry-state.ts's
 * `applyGeometryState` uses) and sets the shared domain, then seeds fresh
 * rows from `state.rows`. Safe to call on an already-populated graph, which
 * is exactly what `NotebookOdeBlock` needs -- its seeding effect runs AFTER
 * `useOdeGraph` has already constructed one default row, so overwriting the
 * free cells alone (like the old single-row version of this function did)
 * isn't enough once rows are dynamically created/deleted cells rather than
 * a fixed set.
 */
export function seedOdeState(graph: CellGraph, containerIds: CellIdsOde, state: OdeState): void {
  const existing = graph.has(containerIds.list) ? graph.get<string[]>(containerIds.list) : [];
  for (const rowId of existing) removeRow(graph, containerIds.list, rowId, cellIdsOde(rowId));
  graph.set(containerIds.xMin, state.xMin);
  graph.set(containerIds.xMax, state.xMax);
  graph.set(containerIds.yMin, state.yMin);
  graph.set(containerIds.yMax, state.yMax);
  const rowIds = state.rows.map(() => crypto.randomUUID());
  graph.set(containerIds.list, rowIds, { auxiliary: true });
  rowIds.forEach((id, i) => seedOdeRow(graph, containerIds, id, state.rows[i] as OdeRowState));
}

/** Builds the full serializable state of an ODE panel -- shared by the URL-sync effect and the save-to-gallery handler. */
export function getCurrentOdeState(graph: CellGraph, containerIds: CellIdsOde): OdeState {
  return {
    v: 2,
    xMin: graph.get<string>(containerIds.xMin),
    xMax: graph.get<string>(containerIds.xMax),
    yMin: graph.get<string>(containerIds.yMin),
    yMax: graph.get<string>(containerIds.yMax),
    rows: graph.get<string[]>(containerIds.list).map((rowId) => {
      const ids = cellIdsOde(rowId);
      return {
        expr: graph.get<string>(ids.expr),
        x0: graph.get<string>(ids.x0),
        y0: graph.get<string>(ids.y0),
        color: graph.get<number>(ids.color),
        visible: graph.get<boolean>(ids.visible),
      };
    }),
  };
}

/**
 * The first row (#336 item 7): unlike a plotted curve, a slope field and a
 * video export are both expensive/visually-exclusive per-panel resources,
 * not naturally per-row things to multiply -- overlaying N slope fields
 * (one per row's own f(x,y)) would be unreadable arrow-on-arrow noise, and
 * video export would need real job-queue changes to render more than one
 * trajectory. Scoping both to the first row is the same "primary row"
 * convention GraphCanvasMulti's own `getPrimaryRow` established for its
 * single-curve point-readout/sonification features -- every row still gets
 * its own plotted solution curve, just not its own slope field/export.
 */
function getPrimaryRow(graph: CellGraph, containerIds: CellIdsOde): { rowId: string; ids: ReturnType<typeof cellIdsOde> } | null {
  const rowId = graph.get<string[]>(containerIds.list)[0];
  return rowId === undefined ? null : { rowId, ids: cellIdsOde(rowId) };
}

/**
 * Sets up the ODE panel's reactive cells -- an f(x,y) expression plus an
 * initial condition and a rectangular domain, a different input shape from
 * GraphCanvas's single expression + axis variable, so (like
 * SystemSolverPanel/StatisticsPanel) it isn't woven into
 * `cellIds`/`useExpressionGraph`. Shares an `externalGraph` when supplied
 * (e.g. a notebook block) instead of creating a private one, mirroring
 * Graph3DCanvas's `useExpressionGraph3D` -- URL-hash hydration only applies
 * to the standalone, private-graph case, since an external graph's owner
 * (NotebookPanel) is responsible for its own seeding.
 */
function useOdeGraph(cellId: string, externalGraph?: CellGraph): CellGraph {
  const ref = useRef<CellGraph | null>(null);
  if (!ref.current) {
    const graph = externalGraph ?? new CellGraph();
    const containerIds = cellIdsOde(cellId);
    if (!graph.has(containerIds.list)) {
      graph.set(containerIds.list, [] as string[], { auxiliary: true });
      const decoded = !externalGraph && typeof window !== "undefined" ? decodeOdeState(window.location.hash.slice(1)) : null;
      seedOdeState(graph, containerIds, decoded ?? DEFAULT_ODE_STATE);
    }
    ref.current = graph;
  }
  return ref.current;
}

export interface OdePanelProps {
  cellId?: string;
  /** Share an existing CellGraph (e.g. from a notebook block) instead of creating a private one. */
  graph?: CellGraph;
  /** Hydrate from and write to the URL fragment. Off for a notebook-embedded instance, whose document owns persistence instead. */
  syncUrl?: boolean;
}

/**
 * Pure re-render of the slope-field + solution-paths canvas, extracted from
 * the draw effect below so `PngExportButton`'s `renderAtScale` (issue #278)
 * can call it against a fresh offscreen canvas at any size. Unlike v1, this
 * reads live off `graph` (not passed-in primitives) since it now has to
 * iterate an arbitrary row list, the same shape `drawOde2Panel` uses.
 */
export function drawOdePanel(ctx: CanvasRenderingContext2D, width: number, height: number, graph: CellGraph, containerIds: CellIdsOde): void {
  ctx.clearRect(0, 0, width, height);
  const viewport: Viewport = {
    xMin: Number(graph.get<string>(containerIds.xMin)) || -5,
    xMax: Number(graph.get<string>(containerIds.xMax)) || 5,
    yMin: Number(graph.get<string>(containerIds.yMin)) || -5,
    yMax: Number(graph.get<string>(containerIds.yMax)) || 5,
  };
  drawAxes(ctx, viewport, width, height);
  const primary = getPrimaryRow(graph, containerIds);
  if (primary) {
    try {
      const slopeField = graph.get<SlopeFieldResult>(primary.ids.slopeField);
      if (slopeField.ok) drawSlopeField(ctx, slopeField.points, viewport, width, height);
    } catch {
      // Not registered yet -- skip this frame.
    }
  }
  for (const rowId of graph.get<string[]>(containerIds.list)) {
    const ids = cellIdsOde(rowId);
    try {
      if (!graph.get<boolean>(ids.visible)) continue;
      const solution = graph.get<SolutionResult>(ids.solution);
      if (!solution.ok) continue;
      const color = graph.get<number>(ids.color);
      drawPath(ctx, { ...solution.path, stroke: { ...solution.path.stroke, color } }, viewport, width, height);
    } catch {
      // A row whose cells haven't registered yet -- skip it this frame.
    }
  }
}

/** One initial-value-problem row's controls (#336 item 7): expression, initial condition, color/visibility, and its own closed-form readout. */
function OdeRow({ graph, rowId, onRemove }: { graph: CellGraph; rowId: string; onRemove?: () => void }) {
  const ids = cellIdsOde(rowId);
  const expr = useCell<string>(graph, ids.expr);
  const x0 = useCell<string>(graph, ids.x0);
  const y0 = useCell<string>(graph, ids.y0);
  const color = useCell<number>(graph, ids.color);
  const visible = useCell<boolean>(graph, ids.visible);
  const closedForm = useCell<OdeClosedFormAttempt>(graph, ids.closedForm);

  return (
    <div style={{ margin: "0.35rem 0", padding: "0.35rem", border: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
        <input type="checkbox" checked={visible} onChange={(e) => graph.set(ids.visible, e.target.checked)} title="Show/hide this curve" />
        <input
          type="color"
          value={`#${color.toString(16).padStart(6, "0")}`}
          onChange={(e) => graph.set(ids.color, Number.parseInt(e.target.value.slice(1), 16))}
        />
        <label>
          dy/dx = <input value={expr} onChange={(e) => graph.set(ids.expr, e.target.value)} style={{ font: "inherit", width: "18ch" }} />
        </label>
        {onRemove && (
          <button type="button" onClick={onRemove} title="Remove this equation">
            ✕
          </button>
        )}
      </div>
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          y(
          <input value={x0} onChange={(e) => graph.set(ids.x0, e.target.value)} style={{ font: "inherit", width: "6ch" }} />
          ) ={" "}
          <input value={y0} onChange={(e) => graph.set(ids.y0, e.target.value)} style={{ font: "inherit", width: "6ch" }} />
        </label>
      </div>
      {closedForm.found && (
        <p style={{ margin: "0.25rem 0" }}>
          Closed form: <CopyableTex tex={closedForm.explicit ? `y = ${closedForm.latex}` : `${closedForm.latex} = 0`} />
        </p>
      )}
    </div>
  );
}

/**
 * Unlimited first-order IVPs dy/dx = f(x,y), y(x0)=y0 (#336 item 7),
 * plotted against one shared slope field, on one shared, pannable x/y
 * domain -- v1 was a single equation only; every equation now gets its own
 * color/visibility, the same "shared domain, unlimited rows" shape
 * Ode2Panel already established for its sibling 2nd-order panel. The slope
 * field itself (and video export) stay scoped to the first row -- see
 * `getPrimaryRow`'s own doc comment for why.
 */
export function OdePanel({ cellId = "ode-1", graph: externalGraph, syncUrl = true }: OdePanelProps = {}) {
  const graph = useOdeGraph(cellId, externalGraph);
  const containerIds = cellIdsOde(cellId);
  // Namespaced by cellId so two OdePanel instances sharing one CellGraph
  // (e.g. a notebook with more than one embedded ODE block) don't collide on
  // tool names, same fix as GraphCanvas's.
  useCellGraphTools(`calculus_ode_${cellId}`, graph);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rowIds = useCell<string[]>(graph, containerIds.list);

  const xMin = useCell<string>(graph, containerIds.xMin);
  const xMax = useCell<string>(graph, containerIds.xMax);
  const yMin = useCell<string>(graph, containerIds.yMin);
  const yMax = useCell<string>(graph, containerIds.yMax);

  // Standalone only (issue #43, same enabled:syncUrl pattern as #121/#122):
  // a notebook-embedded instance shares its graph with NotebookPanel's own
  // useUndoHistory, so a second independent history here would double-fire
  // on Ctrl+Z.
  const history = useUndoHistory(
    graph,
    () => getCurrentOdeState(graph, containerIds),
    (state) => seedOdeState(graph, containerIds, state),
    250,
    undefined,
    syncUrl,
  );

  function addEquation() {
    const { id, index } = appendRow(graph, containerIds.list);
    seedOdeRowDefault(graph, containerIds, id, index);
  }

  function removeEquation(rowId: string) {
    removeRow(graph, containerIds.list, rowId, cellIdsOde(rowId));
  }

  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const startOdeExportJobFn = useServerFn(startOdeExportJob);
  const renderOdePreviewFrameFn = useServerFn(renderOdePreviewFrame);
  // Lifted out of VideoExportControls (as a controlled prop) so the preview
  // scrubber below can size its range to the same clip length the Export
  // button will actually render -- mirrors Graph3DCanvas's identical
  // `exportDuration` state (mallory-graph#9), added here to close #337's
  // "video export with no on-page animation preview" gap.
  const [exportDuration, setExportDuration] = useState(4);

  async function handleSave() {
    const title = window.prompt("Title for this saved ODE setup:", "Untitled");
    if (title === null) return;
    try {
      addLocalSave({ title, kind: "ode", state: getCurrentOdeState(graph, containerIds) });
      setSaveStatus(`Saved as "${title || "Untitled"}" to My saves on this device — reopen or publish it from the gallery.`);
    } catch (e) {
      setSaveStatus(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Keep the URL fragment in sync with the live graph state, mirroring
  // GraphCanvasMulti's writeUrl/subscribeAll pattern.
  useEffect(() => {
    if (!syncUrl) return;
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeOdeState(getCurrentOdeState(graph, containerIds))}`);
    }
    writeUrl();
    return graph.subscribeAll(writeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, syncUrl]);

  const viewport: Viewport = {
    xMin: Number(xMin) || -5,
    xMax: Number(xMax) || 5,
    yMin: Number(yMin) || -5,
    yMax: Number(yMax) || 5,
  };

  // Redraws whenever the row list changes, the shared domain changes, or
  // any individual row's own cells do -- graph.subscribeAll rather than
  // per-row useCell hooks, same reasoning as Ode2Panel's identical redraw.
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const redraw = () => drawOdePanel(ctx, WIDTH, HEIGHT, graph, containerIds);
    redraw();
    return graph.subscribeAll(redraw);
  }, [graph, containerIds]);

  const primary = getPrimaryRow(graph, containerIds);
  const primaryExpr = primary ? graph.get<string>(primary.ids.expr) : "";
  const primaryX0 = primary ? Number(graph.get<string>(primary.ids.x0)) || 0 : 0;
  const primaryY0 = primary ? Number(graph.get<string>(primary.ids.y0)) || 0 : 0;
  const anyError = rowIds
    .map((rowId) => graph.get<SolutionResult>(cellIdsOde(rowId).solution))
    .find((s) => !s.ok);
  const primarySlopeField = primary ? graph.get<SlopeFieldResult>(primary.ids.slopeField) : { ok: true as const, points: [] };

  return (
    <div>
      {rowIds.map((rowId) => (
        <OdeRow key={rowId} graph={graph} rowId={rowId} onRemove={rowIds.length > 1 ? () => removeEquation(rowId) : undefined} />
      ))}
      <button type="button" onClick={addEquation} style={{ margin: "0.35rem 0" }}>
        + Add equation
      </button>
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          x: [<input value={xMin} onChange={(e) => graph.set(containerIds.xMin, e.target.value)} style={{ font: "inherit", width: "6ch" }} />
          ,{" "}
          <input value={xMax} onChange={(e) => graph.set(containerIds.xMax, e.target.value)} style={{ font: "inherit", width: "6ch" }} />]
        </label>{" "}
        <label>
          y: [<input value={yMin} onChange={(e) => graph.set(containerIds.yMin, e.target.value)} style={{ font: "inherit", width: "6ch" }} />
          ,{" "}
          <input value={yMax} onChange={(e) => graph.set(containerIds.yMax, e.target.value)} style={{ font: "inherit", width: "6ch" }} />]
        </label>
      </div>
      <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} style={{ border: "1px solid var(--border)" }} />
      <div style={{ margin: "0.25rem 0" }}>
        <PngExportButton
          getCanvas={() => canvasRef.current}
          label="ode"
          renderAtScale={(ctx, width, height) => drawOdePanel(ctx, width, height, graph, containerIds)}
          baseWidth={WIDTH}
          baseHeight={HEIGHT}
        />
        <SvgExportButton
          getSvg={() => {
            const layers: SvgLayer[] = [];
            if (primarySlopeField.ok) layers.push({ kind: "slopefield", points: primarySlopeField.points });
            for (const rowId of rowIds) {
              const ids = cellIdsOde(rowId);
              if (!graph.hasValue(ids.solution) || !graph.get<boolean>(ids.visible)) continue;
              const solution = graph.get<SolutionResult>(ids.solution);
              if (solution.ok) layers.push({ kind: "path", path: solution.path });
            }
            return layers.length > 0 ? layersToSvgDocument(layers, viewport, WIDTH, HEIGHT) : null;
          }}
          label="ode"
        />
      </div>
      {anyError && <p style={{ color: "var(--danger)" }}>{anyError.ok ? "" : anyError.message}</p>}
      {/* Server-side ecmanim export: the primary row's slope field as a
          vector field plus its RK4 solution progressively traced out from
          the initial condition (johnhenry/mallory-graph#3, pass 2). Scoped
          to the first row only -- see getPrimaryRow's own doc comment. */}
      {rowIds.length > 1 && (
        <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "0.25rem 0" }}>
          Video export below renders only the first equation's trajectory.
        </p>
      )}
      <VideoExportControls
        filenameStem="mallory-graph-ode"
        duration={exportDuration}
        onDurationChange={setExportDuration}
        start={(format, duration) =>
          startOdeExportJobFn({
            data: {
              source: primaryExpr,
              x0: primaryX0,
              y0: primaryY0,
              viewport,
              duration,
              format,
            },
          })
        }
      />
      {/* Scrub preview (#337): shares the exact same source/x0/y0/viewport
          the Export button above uses, so it can never drift from the real
          render -- mirrors Graph3DCanvas's surface-export preview
          (mallory-graph#9). */}
      <ExportPreviewScrubber
        maxTime={exportDuration}
        fetchFrame={async (time) => {
          const frame = await renderOdePreviewFrameFn({
            data: { source: primaryExpr, x0: primaryX0, y0: primaryY0, viewport, duration: exportDuration, format: "mp4", time },
          });
          return frame;
        }}
      />
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
