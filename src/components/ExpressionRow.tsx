import { Symbolic, type DifferentiationStep, type Expr } from "@johnhenry/math";
import { useEffect, useRef, useState } from "react";
import type { CellGraph } from "@johnhenry/math";
import { cellIdsMultiRow, notebookValueCellId, VIEWPORT_CELL } from "../lib/cell-ids.ts";
import { findCurveExtrema } from "../lib/curve-extrema.ts";
import { collectFreeVars, defaultSliderRange } from "../lib/free-vars.ts";
import { exprToLatex } from "../lib/expr-to-latex.ts";
import { integersModuloStructure } from "../lib/finite-structure.ts";
import { preprocessImplicitMultiplication } from "../lib/implicit-mult.ts";
import type { Viewport } from "../lib/render-path.ts";
import { findDiscontinuities, findRootCrossings, sampleExpr, sampleExprAdaptive, sampleRegionMask } from "../lib/sample-function.ts";
import { sampleStructureExpr, type ScatterPoint } from "../lib/sample-structure.ts";
import { useCell } from "../lib/use-cell.ts";
import { CopyableTex } from "./CopyableTex.tsx";
import { MathInput } from "./MathInput.tsx";
import { TexSpan } from "./TexSpan.tsx";

const RESOLUTION = 400;
const AXIS_VARIABLE = "x";

/** Mirrors GraphCanvas.tsx's own STRUCTURE_OPTIONS -- kept as a separate local copy rather than shared since it's UI-only (the compute side just reads a plain `number | null` modulus). */
const STRUCTURE_OPTIONS: Array<{ label: string; modulus: number | null }> = [
  { label: "Real numbers", modulus: null },
  { label: "Z/2Z (GF(2))", modulus: 2 },
  { label: "Z/5Z", modulus: 5 },
  { label: "Z/7Z (GF(7))", modulus: 7 },
  { label: "Z/11Z", modulus: 11 },
];

interface AreaResult {
  value: number;
  path: ReturnType<typeof sampleExpr>;
}

interface Derivative {
  steps: DifferentiationStep[];
  result: Expr;
}

/**
 * Sets up one row's reactive cells: expr -> freeVars -> per-variable slider
 * params -> a path sampled against the shared VIEWPORT_CELL, colored per the
 * row's own color cell. A much smaller cell family than single-pane
 * GraphCanvas's `useExpressionGraph` -- see `cellIdsMultiRow`'s doc comment
 * for what's deliberately not ported here yet (point-drag; exact mode is
 * shared across the panel rather than per-row).
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
      graph.set(ids.structure, null as number | null, { auxiliary: true });

      // Area-under-curve (issue #51): bounds are plain fixed numeric
      // inputs, not the auto-inferred-slider mechanism, same reasoning as
      // GraphCanvas's own ids.areaLower/areaUpper. Seeded from the current
      // viewport at row-creation time, not read live, so an in-progress
      // pan/zoom doesn't silently move a bound the user already set.
      graph.set(ids.showArea, false, { auxiliary: true });
      const initialViewport = graph.get<Viewport>(viewportCellId);
      graph.set(ids.areaLower, initialViewport.xMin, { auxiliary: true });
      graph.set(ids.areaUpper, (initialViewport.xMin + initialViewport.xMax) / 2, { auxiliary: true });

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

      // Local maxima/minima on the same sampled path (issue #50's
      // generated-description input) -- the same declarative "condition
      // cell" pattern as roots/discontinuities above, mirroring
      // GraphCanvas's own `ids.extrema` cell.
      graph.define(ids.extrema, () => findCurveExtrema(graph.get(ids.path)), { auxiliary: true });

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

      // Area-under-curve value + shaded fill (issue #51), same "off costs
      // nothing" convention as derivativePath above. Symbolic.integrateDefinite
      // gives the exact numeric value; sampleExpr (not the adaptive sampler)
      // re-renders the fill polygon over just [lower, upper] since a filled
      // region's edge doesn't need curvature-driven refinement the way a
      // stroked line does -- matches GraphCanvas's own choice for this cell.
      let lastGoodArea: AreaResult | null = null;
      graph.define(
        ids.area,
        (): AreaResult | null => {
          if (!graph.get<boolean>(ids.showArea)) return null;
          try {
            const lower = graph.get<number>(ids.areaLower);
            const upper = graph.get<number>(ids.areaUpper);
            const params = graph.get<Record<string, number>>(ids.params);
            const viewport = graph.get<Viewport>(viewportCellId);
            const expr = Symbolic.parse(preprocessImplicitMultiplication(graph.get<string>(ids.expr)));
            const value = Symbolic.integrateDefinite(expr, lower, upper, AXIS_VARIABLE, params);
            const path = sampleExpr(
              expr,
              { min: Math.min(lower, upper), max: Math.max(lower, upper) },
              RESOLUTION,
              AXIS_VARIABLE,
              params,
              graph.get<number>(ids.color),
              { min: viewport.yMin, max: viewport.yMax },
            );
            lastGoodArea = { value, path };
          } catch {
            // Keep the last good shaded region/value on a mid-typing parse error or an out-of-domain bound.
          }
          return lastGoodArea;
        },
        { auxiliary: true },
      );

      // Step-by-step differentiation trace (issue #51). Unconditional, like
      // GraphCanvas's own ids.derivative -- a single differentiate pass is
      // cheap regardless of whether the accordion showing it is open, so
      // there's no "off" gate here (unlike showDerivative/showArea, which
      // guard real sampling work). Whether the trace is DISPLAYED for a
      // given row is purely local UI state (showSteps below), not a cell.
      graph.define(
        ids.derivative,
        (): Derivative | null => {
          try {
            const expr = Symbolic.parse(preprocessImplicitMultiplication(graph.get<string>(ids.expr)));
            return Symbolic.differentiateSteps(expr, AXIS_VARIABLE);
          } catch {
            return null;
          }
        },
        { auxiliary: true },
      );

      // 1D inequality shading (issue #51), same "only populated for a `cmp`
      // top-level expression" gate as GraphCanvas's own ids.regionMask --
      // sampleRegionMask itself returns null for any non-inequality
      // expression, so nothing extra needs guarding here.
      graph.define(
        ids.regionMask,
        (): boolean[] | null => {
          try {
            const viewport = graph.get<Viewport>(viewportCellId);
            const expr = Symbolic.parse(preprocessImplicitMultiplication(graph.get<string>(ids.expr)));
            const params = graph.get<Record<string, number>>(ids.params);
            return sampleRegionMask(expr, { min: viewport.xMin, max: viewport.xMax }, RESOLUTION, AXIS_VARIABLE, params);
          } catch {
            return null;
          }
        },
        { auxiliary: true },
      );

      // Finite-structure scatter mode (issue #51): null (the default) means
      // "plot over the reals" -- GraphCanvasMulti's redraw loop draws the
      // usual continuous path/overlays for that case. Once a modulus is
      // set, this becomes non-null and REPLACES all of that, same
      // "scatter or everything else, never both" branching GraphCanvas's
      // own single-pane draw effect uses (a finite structure has no
      // continuous curve, area, or region to shade).
      graph.define(
        ids.scatter,
        (): ScatterPoint[] | null => {
          const modulus = graph.get<number | null>(ids.structure);
          if (modulus === null) return null;
          try {
            const params = graph.get<Record<string, number>>(ids.params);
            return sampleStructureExpr(graph.get<string>(ids.expr), integersModuloStructure(modulus), AXIS_VARIABLE, params);
          } catch {
            return [];
          }
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
  const showArea = useCell<boolean>(graph, ids.showArea);
  const areaLower = useCell<number>(graph, ids.areaLower);
  const areaUpper = useCell<number>(graph, ids.areaUpper);
  const area = useCell<AreaResult | null>(graph, ids.area);
  const derivative = useCell<Derivative | null>(graph, ids.derivative);
  const structure = useCell<number | null>(graph, ids.structure);
  const error = useCell<string | null>(graph, ids.error);
  const [exprInput, setExprInput] = useState(expr);
  const [useMathKeyboard, setUseMathKeyboard] = useState(false);
  const [latexInput, setLatexInput] = useState(() => toLatexOrEmpty(expr));
  // Purely local UI state, not a cell -- matches GraphCanvas's own
  // showSteps exactly (the derivative compute above is unconditional;
  // this only controls whether the trace accordion is open).
  const [showSteps, setShowSteps] = useState(false);

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
        <label style={{ fontSize: "0.78rem", color: "var(--muted)" }} title="Shade the area under this curve between two bounds">
          <input type="checkbox" checked={showArea} onChange={(e) => graph.set(ids.showArea, e.target.checked)} />{" "}
          ∫
        </label>
        {showArea && (
          <span style={{ fontSize: "0.78rem", color: "var(--muted)", display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
            [
            <input
              type="number"
              value={areaLower}
              step="any"
              style={{ font: "inherit", width: "5ch" }}
              onChange={(e) => graph.set(ids.areaLower, Number(e.target.value))}
            />
            ,
            <input
              type="number"
              value={areaUpper}
              step="any"
              style={{ font: "inherit", width: "5ch" }}
              onChange={(e) => graph.set(ids.areaUpper, Number(e.target.value))}
            />
            ] {area ? `= ${area.value.toFixed(4)}` : ""}
          </span>
        )}
        {derivative && (
          <label style={{ fontSize: "0.78rem", color: "var(--muted)" }} title="Step-by-step differentiation trace for this row">
            <input type="checkbox" checked={showSteps} onChange={(e) => setShowSteps(e.target.checked)} /> steps
          </label>
        )}
        <label style={{ fontSize: "0.78rem", color: "var(--muted)" }} title="Plot this row over a finite structure (Z/nZ) instead of the reals">
          <select
            value={
              structure === null ? "real" : STRUCTURE_OPTIONS.some((opt) => opt.modulus === structure) ? String(structure) : "custom"
            }
            onChange={(e) => {
              const v = e.target.value;
              if (v === "real") graph.set(ids.structure, null);
              else if (v === "custom") graph.set(ids.structure, 13); // seed a default so the number input below has something to edit
              else graph.set(ids.structure, Number(v));
            }}
          >
            {STRUCTURE_OPTIONS.map((opt) => (
              <option key={opt.label} value={opt.modulus === null ? "real" : String(opt.modulus)}>
                {opt.label}
              </option>
            ))}
            <option value="custom">Custom Z/nZ…</option>
          </select>
        </label>
        {structure !== null && !STRUCTURE_OPTIONS.some((opt) => opt.modulus === structure) && (
          <label style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
            n:{" "}
            <input
              type="number"
              min={2}
              value={structure}
              style={{ font: "inherit", width: "6ch" }}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isInteger(n) && n >= 2) graph.set(ids.structure, n);
              }}
            />
          </label>
        )}
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
      {showSteps && derivative && (
        <div style={{ fontSize: "0.85rem", margin: "0.25rem 0 0 1.5rem" }}>
          dy/dx = <CopyableTex tex={exprToLatex(derivative.result)} />
          <ol>
            {derivative.steps.map((step, i) => (
              <li key={i}>
                <strong>{step.rule}</strong>: d/dx[<TexSpan tex={exprToLatex(step.input)} />] = <TexSpan tex={exprToLatex(step.output)} />
              </li>
            ))}
          </ol>
        </div>
      )}
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
