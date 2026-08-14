import { Symbolic } from "mallory-math";
import { useEffect, useRef, useState } from "react";
import type { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsMultiRow, notebookValueCellId, VIEWPORT_CELL } from "../lib/cell-ids.ts";
import { collectFreeVars, defaultSliderRange } from "../lib/free-vars.ts";
import { preprocessImplicitMultiplication } from "../lib/implicit-mult.ts";
import type { Viewport } from "../lib/render-path.ts";
import { findDiscontinuities, findRootCrossings, sampleExprAdaptive } from "../lib/sample-function.ts";
import { useCell } from "../lib/use-cell.ts";
import { MathInput } from "./MathInput.tsx";

const RESOLUTION = 400;
const AXIS_VARIABLE = "x";

/**
 * Sets up one row's reactive cells: expr -> freeVars -> per-variable slider
 * params -> a path sampled against the shared VIEWPORT_CELL, colored per the
 * row's own color cell. A much smaller cell family than single-pane
 * GraphCanvas's `useExpressionGraph` -- see `cellIdsMultiRow`'s doc comment
 * for what's deliberately not ported here yet (point-drag, exact mode,
 * derivative steps, area/region shading, finite-structure scatter).
 *
 * Guarded by `!graph.hasValue(ids.path)` (not just the mount ref) so mounting
 * a second ExpressionRow pointed at an already-populated row id is a safe
 * no-op, matching `useExpressionGraph`'s own convention in GraphCanvas.tsx.
 * Deliberately `hasValue`, not `has`: `has()` returns true the instant
 * *anything* reads a cell via `get()`, even before it's ever been set/
 * defined (see CellGraph.hasValue's own doc comment) -- and something does:
 * GraphCanvasMulti/NotebookGraphBlock's `graph.subscribeAll(redraw)` fires
 * synchronously and reentrantly the moment `addRow()` writes the new row id
 * into EXPRESSION_LIST_CELL (still mid-`addRow()`, before this component
 * ever mounts), and `redraw()` immediately calls `graph.get(ids.path)` for
 * every id in that list, including the brand-new one -- which `ensure()`s an
 * empty cell record as a side effect. `has(ids.path)` then wrongly reads
 * true when this component actually mounts moments later, skipping this
 * entire block and leaving `freeVars` (and everything else) permanently
 * undefined for that row. `hasValue()` isn't fooled by that stray touch,
 * since it only turns true once a real compute has actually run.
 */
type PathResult = { ok: true; path: ReturnType<typeof sampleExprAdaptive> } | { ok: false; message: string };

function useRowCells(graph: CellGraph, rowId: string, viewportCellId: string = VIEWPORT_CELL): ReturnType<typeof cellIdsMultiRow> {
  const ids = cellIdsMultiRow(rowId);
  const ref = useRef(false);
  if (!ref.current) {
    ref.current = true;
    if (!graph.hasValue(ids.path)) {
      graph.set(ids.strict, false, { auxiliary: true });
      graph.set(ids.showDerivative, false, { auxiliary: true });

      graph.define(
        ids.freeVars,
        () => {
          try {
            const expr = Symbolic.parse(preprocessImplicitMultiplication(graph.get<string>(ids.expr)));
            return collectFreeVars(expr, AXIS_VARIABLE);
          } catch {
            return [];
          }
        },
        { auxiliary: true },
      );

      // A free variable sourced from a notebook "value" block (see
      // cell-ids.ts's notebookValueCellId doc comment) reads live from that
      // block's shared cell instead of this row's own independent slider
      // cell -- registry-free: `hasValue` on the name-keyed cell IS the
      // "does an earlier value block with this name exist" check. Inert
      // for GraphCanvasMulti's own usage, where no `notebookValue:*` cell
      // ever exists on that graph, so `hasValue` is always false there and
      // every free variable falls back to today's local-slider path
      // unchanged.
      //
      // `graph.get(externalId)` is called BEFORE the `hasValue` check
      // (rather than only inside the `hasValue` branch) so this cell
      // registers a dependency edge on `externalId` even when it doesn't
      // exist yet -- `hasValue` alone never calls `ensure()`/registers
      // anything, so a value block created *after* this compute first runs
      // would otherwise never trigger a recompute here. `get()` on a
      // not-yet-existing, never-`define`d/`set` cell returns `undefined`
      // harmlessly (no compute function means no recompute attempt) but
      // does register the edge, so once a matching value block's `set()`
      // finally happens, this cell correctly goes dirty and re-resolves to
      // the external value.
      graph.define(
        ids.params,
        () => {
          const names = graph.get<string[]>(ids.freeVars);
          const params: Record<string, number> = {};
          for (const name of names) {
            const externalId = notebookValueCellId(name);
            const externalValue = graph.get<number | undefined>(externalId);
            params[name] = graph.hasValue(externalId) ? (externalValue as number) : graph.get<number>(ids.param(name));
          }
          return params;
        },
        { auxiliary: true },
      );

      // Single source of truth for whether this row's expression currently
      // parses/samples cleanly -- `path` (falls back to the last good
      // sample) and `error` (surfaces the message) both just read from this,
      // rather than duplicating the try/catch or writing to another cell as
      // a side effect from inside a compute (which CellGraph's pull model
      // doesn't support safely).
      graph.define(
        ids.pathResult,
        (): PathResult => {
          try {
            const viewport = graph.get<Viewport>(viewportCellId);
            const params = graph.get<Record<string, number>>(ids.params);
            const color = graph.get<number>(ids.color);
            const source = graph.get<string>(ids.expr);
            if (graph.get<boolean>(ids.strict)) {
              const parsed = Symbolic.parse(preprocessImplicitMultiplication(source));
              Symbolic.assertVariables(parsed, [AXIS_VARIABLE]);
            }
            const path = sampleExprAdaptive(
              source,
              { min: viewport.xMin, max: viewport.xMax },
              RESOLUTION,
              AXIS_VARIABLE,
              params,
              color,
              {},
              { min: viewport.yMin, max: viewport.yMax },
            );
            return { ok: true, path };
          } catch (e) {
            return { ok: false, message: e instanceof Error ? e.message : String(e) };
          }
        },
        { auxiliary: true },
      );

      let lastGoodPath: ReturnType<typeof sampleExprAdaptive> | null = null;
      graph.define(
        ids.path,
        () => {
          const result = graph.get<PathResult>(ids.pathResult);
          if (result.ok) lastGoodPath = result.path;
          if (!lastGoodPath) throw new Error(`Row "${rowId}" initial expression failed to parse`);
          return lastGoodPath;
        },
        { auxiliary: true },
      );

      graph.define(ids.error, () => {
        const result = graph.get<PathResult>(ids.pathResult);
        return result.ok ? null : result.message;
      });

      // A declarative "condition" derived from the curve's own path, read
      // by GraphCanvasMulti's draw loop to decide whether/how to mark root
      // crossings -- the flag computation is decoupled from the drawing
      // decision, the Open-MCT-inspired pattern from the research roadmap.
      graph.define(ids.roots, () => findRootCrossings(graph.get(ids.path)), { auxiliary: true });

      // Same declarative "condition cell, decoupled from drawing" pattern as
      // `roots` above, generalized: every gap in the sampled path (a
      // singularity or domain boundary), not just where it crosses zero.
      graph.define(ids.discontinuities, () => findDiscontinuities(graph.get(ids.path)), { auxiliary: true });

      // f' as just another sampled curve, reusing the same sampleExprAdaptive
      // path every row's own f already goes through -- Symbolic.differentiate
      // is a total, mechanical tree walk over every current Expr variant, so
      // the only realistic failure mode here is the same mid-typing parse
      // error `path` already handles, hence the same "keep the last good
      // sample" fallback convention. Returns null (not computed at all)
      // while the toggle is off, so leaving it off costs nothing.
      let lastGoodDerivativePath: ReturnType<typeof sampleExprAdaptive> | null = null;
      graph.define(
        ids.derivativePath,
        () => {
          if (!graph.get<boolean>(ids.showDerivative)) return null;
          try {
            const viewport = graph.get<Viewport>(viewportCellId);
            const params = graph.get<Record<string, number>>(ids.params);
            const color = graph.get<number>(ids.color);
            const parsed = Symbolic.parse(preprocessImplicitMultiplication(graph.get<string>(ids.expr)));
            const derivative = Symbolic.differentiate(parsed, AXIS_VARIABLE);
            lastGoodDerivativePath = sampleExprAdaptive(
              derivative,
              { min: viewport.xMin, max: viewport.xMax },
              RESOLUTION,
              AXIS_VARIABLE,
              params,
              color,
              {},
              { min: viewport.yMin, max: viewport.yMax },
            );
          } catch {
            // Keep the last good sample on a mid-typing parse error.
          }
          return lastGoodDerivativePath;
        },
        { auxiliary: true },
      );
    }
  }
  return ids;
}

export interface ExpressionRowProps {
  graph: CellGraph;
  rowId: string;
  onRemove?: () => void;
  /** Defaults to the shared GraphCanvasMulti VIEWPORT_CELL; NotebookGraphBlock passes its own per-block namespaced viewport cell id instead. */
  viewportCellId?: string;
}

/** One row of a GraphCanvasMulti: a color swatch, a visibility toggle, the y= input, and any free-variable sliders it discovers. */
export function ExpressionRow({ graph, rowId, onRemove, viewportCellId }: ExpressionRowProps) {
  const ids = useRowCells(graph, rowId, viewportCellId);
  const expr = useCell<string>(graph, ids.expr);
  const color = useCell<number>(graph, ids.color);
  const visible = useCell<boolean>(graph, ids.visible);
  const freeVars = useCell<string[]>(graph, ids.freeVars);
  const strict = useCell<boolean>(graph, ids.strict);
  const showDerivative = useCell<boolean>(graph, ids.showDerivative);
  const error = useCell<string | null>(graph, ids.error);
  const [exprInput, setExprInput] = useState(expr);
  const [useMathKeyboard, setUseMathKeyboard] = useState(false);
  const [latexInput, setLatexInput] = useState(() => toLatexOrEmpty(expr));

  // Same reasoning as GraphCanvas's own slider-seeding effect: freeVars is
  // read synchronously during render via useCell, so seeding a newly
  // discovered variable's slider cell must happen in an effect, not inline,
  // or the write trips React's "Cannot update a component while rendering a
  // different component" guard and silently gets dropped.
  useEffect(() => {
    for (const name of freeVars) {
      if (graph.hasValue(notebookValueCellId(name))) continue; // sourced externally -- no local slider cell to seed
      const id = ids.param(name);
      if (!graph.hasValue(id)) graph.set(id, defaultSliderRange(name).default);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, freeVars, rowId]);

  function updateExpr(value: string) {
    setExprInput(value);
    graph.set(ids.expr, value);
  }

  // Fed by MathInput's `input` event (LaTeX, live as the user types on the
  // math keyboard). `Symbolic.fromLatex`/`toLatex` already round-trip
  // through every function including piecewise `\cases`, so converting
  // back to plain expression source is a straight call -- the only care
  // needed is that LaTeX is routinely *incomplete* mid-edit (e.g.
  // "\frac{1}{" before the denominator is typed), which throws; leaving the
  // graph's expression untouched on that failure (rather than clearing the
  // curve) matches the same "keep the last good state while typing"
  // convention GraphCanvas's own path/point/exact cells use.
  function updateLatex(nextLatex: string) {
    setLatexInput(nextLatex);
    try {
      const source = Symbolic.toString(Symbolic.fromLatex(nextLatex));
      setExprInput(source);
      graph.set(ids.expr, source);
    } catch {
      // Leave exprInput/the graph's expression at its last good value.
    }
  }

  return (
    <div style={{ margin: "0.25rem 0" }}>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
        <input
          type="checkbox"
          checked={visible}
          onChange={(e) => graph.set(ids.visible, e.target.checked)}
          title="Show/hide this curve"
        />
        <input
          type="color"
          value={`#${color.toString(16).padStart(6, "0")}`}
          onChange={(e) => graph.set(ids.color, Number.parseInt(e.target.value.slice(1), 16))}
        />
        {useMathKeyboard ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
            y = <MathInput latex={latexInput} onChange={updateLatex} style={{ minWidth: "10rem", display: "inline-block" }} />
          </span>
        ) : (
          <label>
            y ={" "}
            <input value={exprInput} onChange={(e) => updateExpr(e.target.value)} style={{ font: "inherit", width: "18ch" }} />
          </label>
        )}
        <label style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
          <input
            type="checkbox"
            checked={useMathKeyboard}
            onChange={(e) => {
              const next = e.target.checked;
              if (next) setLatexInput(toLatexOrEmpty(exprInput));
              setUseMathKeyboard(next);
            }}
          />{" "}
          math keyboard
        </label>
        <label
          style={{ fontSize: "0.78rem", color: "var(--muted)" }}
          title={`When on, "${AXIS_VARIABLE}" is the only allowed variable -- anything else is an error instead of a new slider`}
        >
          <input type="checkbox" checked={strict} onChange={(e) => graph.set(ids.strict, e.target.checked)} />{" "}
          strict ({AXIS_VARIABLE} only)
        </label>
        <label style={{ fontSize: "0.78rem", color: "var(--muted)" }} title="Overlay this row's derivative (dashed, same color)">
          <input
            type="checkbox"
            checked={showDerivative}
            onChange={(e) => graph.set(ids.showDerivative, e.target.checked)}
          />{" "}
          f'
        </label>
        {freeVars.map((name) =>
          graph.hasValue(notebookValueCellId(name)) ? (
            <span key={name} style={{ fontSize: "0.78rem", color: "var(--muted)" }} title={`Sourced from the "${name}" value block`}>
              {name} ← value block
            </span>
          ) : (
            <ParamSlider key={name} graph={graph} paramId={ids.param(name)} name={name} />
          ),
        )}
        {onRemove && (
          <button type="button" onClick={onRemove} title="Remove this expression">
            ✕
          </button>
        )}
      </div>
      {error && <p style={{ fontSize: "0.8rem", color: "var(--danger)", margin: "0.2rem 0 0" }}>{error}</p>}
    </div>
  );
}

function toLatexOrEmpty(source: string): string {
  try {
    return Symbolic.toLatex(Symbolic.parse(preprocessImplicitMultiplication(source)));
  } catch {
    return "";
  }
}

function ParamSlider({ graph, paramId, name }: { graph: CellGraph; paramId: string; name: string }) {
  const range = defaultSliderRange(name);
  const value = useCell<number>(graph, paramId) ?? range.default;
  return (
    <label style={{ fontSize: "0.85rem" }}>
      {name} ={" "}
      <input
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        onChange={(e) => graph.set(paramId, Number(e.target.value))}
      />{" "}
      {value.toFixed(2)}
    </label>
  );
}
