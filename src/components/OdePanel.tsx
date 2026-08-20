import type { Path2D } from "mallory-math";
import { addLocalSave } from "../lib/local-saves.ts";
import { useEffect, useRef, useState } from "react";
import { CellGraph } from "../lib/cell-graph.ts";
import { useServerFn } from "@tanstack/react-start";
import { cellIdsOde, type CellIdsOde } from "../lib/cell-ids.ts";
import { startOdeExportJob } from "../lib/export-ode-video.ts";
import { VideoExportControls } from "./VideoExportControls.tsx";
import { drawAxes, drawPath, drawSlopeField, type Viewport } from "../lib/render-path.ts";
import { attemptOdeClosedForm, type OdeClosedFormAttempt, sampleOdeSolution, sampleSlopeField, type SlopeFieldPoint } from "../lib/sample-ode.ts";
import { DEFAULT_ODE_STATE, decodeOdeState, encodeOdeState, type OdeState } from "../lib/ode-state.ts";
import { layersToSvgDocument, type SvgLayer } from "../lib/svg-export.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useUndoHistory } from "../hooks/use-undo-history.ts";
import { useCell } from "../lib/use-cell.ts";
import { CopyableTex } from "./CopyableTex.tsx";
import { PngExportButton } from "./PngExportButton.tsx";
import { SvgExportButton } from "./SvgExportButton.tsx";

type SolutionResult = { ok: true; path: Path2D } | { ok: false; message: string };
type SlopeFieldResult = { ok: true; points: SlopeFieldPoint[] } | { ok: false; message: string };

const WIDTH = 500;
const HEIGHT = 500;

/** Writes a state's fields onto `graph`'s free cells -- shared by useOdeGraph's own hydrate-from-hash and NotebookOdeBlock's post-mount overwrite (a notebook block can't pre-seed before this panel mounts, since that would skip its `graph.define` setup -- see the file's own useOdeGraph doc comment). */
export function seedOdeState(graph: CellGraph, ids: CellIdsOde, state: OdeState): void {
  graph.set(ids.expr, state.expr);
  graph.set(ids.x0, state.x0);
  graph.set(ids.y0, state.y0);
  graph.set(ids.xMin, state.xMin);
  graph.set(ids.xMax, state.xMax);
  graph.set(ids.yMin, state.yMin);
  graph.set(ids.yMax, state.yMax);
}

/** Builds the full serializable state of an ODE panel -- shared by the URL-sync effect and the save-to-gallery handler. */
export function getCurrentOdeState(graph: CellGraph, ids: CellIdsOde): OdeState {
  return {
    v: 1,
    expr: graph.get<string>(ids.expr),
    x0: graph.get<string>(ids.x0),
    y0: graph.get<string>(ids.y0),
    xMin: graph.get<string>(ids.xMin),
    xMax: graph.get<string>(ids.xMax),
    yMin: graph.get<string>(ids.yMin),
    yMax: graph.get<string>(ids.yMax),
  };
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
    const ids = cellIdsOde(cellId);
    if (!graph.has(ids.expr)) {
      const decoded = !externalGraph && typeof window !== "undefined" ? decodeOdeState(window.location.hash.slice(1)) : null;
      seedOdeState(graph, ids, decoded ?? DEFAULT_ODE_STATE);

      const domain = () => ({
        xMin: Number(graph.get<string>(ids.xMin)),
        xMax: Number(graph.get<string>(ids.xMax)),
        yMin: Number(graph.get<string>(ids.yMin)),
        yMax: Number(graph.get<string>(ids.yMax)),
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

/** v1: a single first-order IVP dy/dx = f(x,y), y(x0) = y0, plotted against its slope field. No animation/dragging. */
/**
 * Pure re-render of the slope-field + solution-path canvas, extracted from
 * the draw effect below so `PngExportButton`'s `renderAtScale` (issue
 * #278) can call it against a fresh offscreen canvas at any size.
 */
export function drawOdePanel(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  viewport: Viewport,
  slopeField: SlopeFieldResult,
  solution: SolutionResult,
): void {
  ctx.clearRect(0, 0, width, height);
  drawAxes(ctx, viewport, width, height);
  if (slopeField.ok) drawSlopeField(ctx, slopeField.points, viewport, width, height);
  if (solution.ok) drawPath(ctx, solution.path, viewport, width, height);
}

export function OdePanel({ cellId = "ode-1", graph: externalGraph, syncUrl = true }: OdePanelProps = {}) {
  const graph = useOdeGraph(cellId, externalGraph);
  // Namespaced by cellId so two OdePanel instances sharing one CellGraph
  // (e.g. a notebook with more than one embedded ODE block) don't collide on
  // tool names, same fix as GraphCanvas's.
  useCellGraphTools(`calculus_ode_${cellId}`, graph);
  const ids = cellIdsOde(cellId);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const expr = useCell<string>(graph, ids.expr);
  const x0 = useCell<string>(graph, ids.x0);
  const y0 = useCell<string>(graph, ids.y0);
  const xMin = useCell<string>(graph, ids.xMin);
  const xMax = useCell<string>(graph, ids.xMax);
  const yMin = useCell<string>(graph, ids.yMin);
  const yMax = useCell<string>(graph, ids.yMax);
  const solution = useCell<SolutionResult>(graph, ids.solution);
  const slopeField = useCell<SlopeFieldResult>(graph, ids.slopeField);
  const closedForm = useCell<OdeClosedFormAttempt>(graph, ids.closedForm);

  // Standalone only (issue #43, same enabled:syncUrl pattern as #121/#122):
  // a notebook-embedded instance shares its graph with NotebookPanel's own
  // useUndoHistory, so a second independent history here would double-fire
  // on Ctrl+Z.
  const history = useUndoHistory(
    graph,
    () => getCurrentOdeState(graph, ids),
    (state) => seedOdeState(graph, ids, state),
    250,
    undefined,
    syncUrl,
  );

  const [exprInput, setExprInput] = useState(expr);
  // Keeps the input box in sync when `ids.expr` changes for a reason other
  // than typing in this same box -- e.g. URL-hash hydration seeding it
  // after this component's own useState initializer already ran (mirrors
  // GraphCanvas's identically-reasoned effect).
  useEffect(() => {
    setExprInput(expr);
  }, [expr]);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const startOdeExportJobFn = useServerFn(startOdeExportJob);

  async function handleSave() {
    const title = window.prompt("Title for this saved ODE setup:", "Untitled");
    if (title === null) return;
        try {
      addLocalSave({ title, kind: "ode", state: getCurrentOdeState(graph, ids) });
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
      window.history.replaceState(null, "", `#${encodeOdeState(getCurrentOdeState(graph, ids))}`);
    }
    writeUrl();
    return graph.subscribeAll(writeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, syncUrl]);

  function updateExpr(value: string) {
    setExprInput(value);
    graph.set(ids.expr, value);
  }

  const viewport: Viewport = {
    xMin: Number(xMin) || -5,
    xMax: Number(xMax) || 5,
    yMin: Number(yMin) || -5,
    yMax: Number(yMax) || 5,
  };

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawOdePanel(ctx, WIDTH, HEIGHT, viewport, slopeField, solution);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solution, slopeField, xMin, xMax, yMin, yMax]);

  return (
    <div>
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          dy/dx ={" "}
          <input value={exprInput} onChange={(e) => updateExpr(e.target.value)} style={{ font: "inherit", width: "20ch" }} />
        </label>
      </div>
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          y(
          <input value={x0} onChange={(e) => graph.set(ids.x0, e.target.value)} style={{ font: "inherit", width: "6ch" }} />
          ) ={" "}
          <input value={y0} onChange={(e) => graph.set(ids.y0, e.target.value)} style={{ font: "inherit", width: "6ch" }} />
        </label>
      </div>
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          x: [<input value={xMin} onChange={(e) => graph.set(ids.xMin, e.target.value)} style={{ font: "inherit", width: "6ch" }} />
          ,{" "}
          <input value={xMax} onChange={(e) => graph.set(ids.xMax, e.target.value)} style={{ font: "inherit", width: "6ch" }} />]
        </label>{" "}
        <label>
          y: [<input value={yMin} onChange={(e) => graph.set(ids.yMin, e.target.value)} style={{ font: "inherit", width: "6ch" }} />
          ,{" "}
          <input value={yMax} onChange={(e) => graph.set(ids.yMax, e.target.value)} style={{ font: "inherit", width: "6ch" }} />]
        </label>
      </div>
      {closedForm.found && (
        <p style={{ margin: "0.25rem 0" }}>
          Closed form: <CopyableTex tex={closedForm.explicit ? `y = ${closedForm.latex}` : `${closedForm.latex} = 0`} />
        </p>
      )}
      <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} style={{ border: "1px solid var(--border)" }} />
      <div style={{ margin: "0.25rem 0" }}>
        <PngExportButton
          getCanvas={() => canvasRef.current}
          label="ode"
          renderAtScale={(ctx, width, height) => drawOdePanel(ctx, width, height, viewport, slopeField, solution)}
          baseWidth={WIDTH}
          baseHeight={HEIGHT}
        />
        <SvgExportButton
          getSvg={() => {
            const layers: SvgLayer[] = [];
            if (slopeField.ok) layers.push({ kind: "slopefield", points: slopeField.points });
            if (solution.ok) layers.push({ kind: "path", path: solution.path });
            return layers.length > 0 ? layersToSvgDocument(layers, viewport, WIDTH, HEIGHT) : null;
          }}
          label="ode"
        />
      </div>
      {(!solution.ok || !slopeField.ok) && (
        <p style={{ color: "var(--danger)" }}>{!solution.ok ? solution.message : !slopeField.ok ? slopeField.message : ""}</p>
      )}
      {/* Server-side ecmanim export: the slope field as a vector field plus
          the RK4 solution progressively traced out from the initial
          condition (johnhenry/mallory-graph#3, pass 2). */}
      <VideoExportControls
        filenameStem="mallory-graph-ode"
        start={(format, duration) =>
          startOdeExportJobFn({
            data: {
              source: expr,
              x0: Number(x0) || 0,
              y0: Number(y0) || 0,
              viewport,
              duration,
              format,
            },
          })
        }
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
          {saveStatus && (
            <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>{saveStatus}</p>
          )}
        </div>
      )}
    </div>
  );
}
