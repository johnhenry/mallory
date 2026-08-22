import { useCallback, useEffect, useId, useRef, useSyncExternalStore } from "react";
import type { CalculatorMode } from "../lib/calculator-eval.ts";
import {
  applyCalculatorState,
  clearCalculatorHistory,
  getCalculatorLiveState,
  setCalculatorInput,
  setCalculatorMode,
  setCalculatorModulus,
  submitCalculatorInput,
  subscribeToCalculator,
} from "../lib/calculator-store.ts";
import { submitCalculatorLine } from "../lib/calculator-eval.ts";
import { useModelContextTool } from "../hooks/use-model-context-tool.ts";

/** Exported so a second CalculatorPanel instance can be told to mirror the standalone route's own state (issue #340's floating calculator) via the `storageKey` prop below, without needing to know this literal. */
export const CALCULATOR_STORAGE_KEY = "mallory:calculator";

const STRUCTURE_OPTIONS: Array<{ label: string; modulus: number | null }> = [
  { label: "Real numbers", modulus: null },
  { label: "Z/2Z (GF(2))", modulus: 2 },
  { label: "Z/5Z", modulus: 5 },
  { label: "Z/7Z (GF(7))", modulus: 7 },
  { label: "Z/11Z", modulus: 11 },
];

/**
 * A REPL-style "just an answer" tool: type an expression, get a result, or
 * store a value for later lines to reuse via `name = expr`, `expr -> name`,
 * or `name <- expr`. No plot/viewport (that's what Graphing is for) --
 * unlike every other panel in this app, it needs no CellGraph (nothing else
 * derives from its state) and persists to `localStorage` rather than a URL
 * hash or the server-backed Gallery, since a scratch calculation isn't the
 * kind of thing worth a shareable link (mallory-graph's SPA-shell pass).
 *
 * State lives in `calculator-store.ts`, a module-level store keyed by
 * `storageKey` (not local `useState`) -- issue #340's floating calculator
 * needs to genuinely mirror the standalone `/calculator` route's own
 * instance live (same typed-but-not-submitted input, same history, same
 * mode), not just share a localStorage key that only syncs on the next
 * page load. `useSyncExternalStore` subscribes this component to whichever
 * store entry `storageKey` resolves to.
 *
 * `instanceId` (issue #255's notebook calculator block) scopes the WebMCP
 * tool names AND (unless `storageKey` is explicitly overridden) the store
 * key too -- omitted (the standalone `/calculator` route's own call site)
 * preserves the original fixed key/names exactly. Passed (a notebook
 * block's own `blockId`, or the floating dock's `"floating"`) gives that
 * instance its own uniquely-named WebMCP tools, avoiding the registration
 * collision issue #255 found; without `storageKey` also passed, it gets
 * its own independent state too, same as before. The floating dock passes
 * BOTH `instanceId="floating"` (for distinct tool names) AND
 * `storageKey={CALCULATOR_STORAGE_KEY}` (to mirror the standalone page's
 * state) -- the two concerns are deliberately independent props.
 */
export function CalculatorPanel({ instanceId, storageKey: storageKeyOverride }: { instanceId?: string; storageKey?: string } = {}) {
  const toolPrefix = instanceId ? `calculator_${instanceId}` : "calculator";
  const storageKey = storageKeyOverride ?? (instanceId ? `${CALCULATOR_STORAGE_KEY}:${instanceId}` : CALCULATOR_STORAGE_KEY);
  // A per-RENDERED-INSTANCE unique id for the mode radio group's `name`
  // attribute -- deliberately NOT derived from `storageKey`/`instanceId`.
  // Two CalculatorPanel instances sharing a `storageKey` still each mount
  // their own separate <input type="radio"> DOM elements; without a
  // per-instance-unique `name`, the browser's own native single-selection-
  // per-name-group enforcement fights React's controlled `checked` prop
  // across the two separate trees (confirmed live: this is what caused the
  // floating calculator to visibly interfere with the standalone page's
  // radio buttons before this fix) -- independent of whether the
  // underlying state is shared, which only needs to be right so both
  // instances compute the same `checked` values, not so the DOM elements
  // themselves share an identity.
  const radioGroupName = `calc-mode-${useId()}`;

  const live = useSyncExternalStore(
    useCallback((onChange) => subscribeToCalculator(storageKey, onChange), [storageKey]),
    () => getCalculatorLiveState(storageKey),
    () => getCalculatorLiveState(storageKey),
  );
  const { data: state, mode, modulus, input } = live;
  const historyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = historyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.history.length]);

  const variableNames = Object.keys(state.variables);

  // Wraps the same submitCalculatorLine the Enter key uses -- an agent's
  // evaluation is indistinguishable from one typed in the UI, including
  // being appended to the same persisted history (and, now, visible in a
  // mirrored instance too, if one is mounted).
  useModelContextTool({
    name: `${toolPrefix}_evaluate`,
    description:
      'Evaluate an expression, or store a value for later expressions to reference: "name = expr", or directionally '
      + '"expr -> name" / "name <- expr". Uses the calculator\'s current mode (Float/Exact/Units/Interval/Complex/GF(n)).',
    inputSchema: {
      type: "object",
      properties: {
        expression: { type: "string", description: 'e.g. "12 * (4 + 1/3)", "r = sqrt(2)", or "r*2 -> d"' },
      },
      required: ["expression"],
    },
    handler: (input: Record<string, unknown>) => {
      const expression = String(input.expression ?? "");
      const current = getCalculatorLiveState(storageKey);
      const next = submitCalculatorLine(expression, current.data, current.mode, current.modulus);
      const entry = next.history[next.history.length - 1];
      if (!entry) throw new Error("Empty expression.");
      applyCalculatorState(storageKey, next);
      if (entry.isError) throw new Error(entry.display);
      return { result: entry.display, isAssignment: entry.isAssignment, variables: next.variables };
    },
  });

  useModelContextTool({
    name: `${toolPrefix}_set_mode`,
    description:
      'Set the calculator\'s arithmetic mode: "float", "exact" (fractions), "units" (dimensional analysis, e.g. "5 m/s * 3 s"), "interval" (rigorous bounds, e.g. "sqrt(2)" -> "[1.414..., 1.414...]"), "complex" (basic +-*/^ arithmetic with "i", e.g. "(3+4i)*(1-2i)"), or a finite structure Z/nZ via modulus (2, 5, 7, or 11).',
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["float", "exact", "units", "interval", "complex"], description: "Ignored when modulus is set." },
        modulus: { type: ["number", "null"], description: "One of 2, 5, 7, 11 for Z/nZ, or null (or omit) for real numbers." },
      },
    },
    handler: (input: Record<string, unknown>) => {
      if (input.modulus !== undefined && input.modulus !== null) {
        const m = Number(input.modulus);
        if (![2, 5, 7, 11].includes(m)) throw new Error("modulus must be one of 2, 5, 7, 11.");
        setCalculatorModulus(storageKey, m);
      } else if (input.modulus === null) {
        setCalculatorModulus(storageKey, null);
      }
      if (input.mode === "float" || input.mode === "exact" || input.mode === "units" || input.mode === "interval" || input.mode === "complex")
        setCalculatorMode(storageKey, input.mode as CalculatorMode);
      return { ok: true };
    },
  });

  return (
    <div>
      <label style={{ display: "block", margin: "0.5rem 0" }}>
        Structure:{" "}
        <select
          value={modulus === null ? "real" : String(modulus)}
          onChange={(e) => {
            const v = e.target.value;
            setCalculatorModulus(storageKey, v === "real" ? null : Number(v));
          }}
        >
          {STRUCTURE_OPTIONS.map((opt) => (
            <option key={opt.label} value={opt.modulus === null ? "real" : String(opt.modulus)}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
      <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>
        A <em>structure</em> is the algebraic system expressions are evaluated in. <strong>Real numbers</strong> is
        ordinary arithmetic. The <strong>Z/nZ</strong> options are finite modular arithmetic: every result wraps
        into <code>{"{0, ..., n-1}"}</code>; with prime <code>n</code> (2, 5, 7, 11 here) every nonzero element has a
        reciprocal, so division works for anything except 0.
      </p>
      {modulus === null && (
        <div role="radiogroup" aria-label="Arithmetic mode" style={{ margin: "0.5rem 0" }}>
          <label title="Ordinary rounded decimal arithmetic.">
            <input type="radio" name={radioGroupName} checked={mode === "float"} onChange={() => setCalculatorMode(storageKey, "float")} /> Float
          </label>{" "}
          <label title="Keeps results as exact fractions instead of rounding to a decimal.">
            <input type="radio" name={radioGroupName} checked={mode === "exact"} onChange={() => setCalculatorMode(storageKey, "exact")} /> Exact
          </label>{" "}
          <label title="Dimensional analysis: numbers carry physical units (m, s, kg, ...) and convert between compatible units.">
            <input type="radio" name={radioGroupName} checked={mode === "units"} onChange={() => setCalculatorMode(storageKey, "units")} /> Units
          </label>{" "}
          <label title="Interval arithmetic: every result comes with mathematically guaranteed lower/upper bounds instead of a single float.">
            <input type="radio" name={radioGroupName} checked={mode === "interval"} onChange={() => setCalculatorMode(storageKey, "interval")} /> Interval
          </label>{" "}
          <label title='Complex arithmetic (+, -, *, /, ^, and elementary functions like sqrt/sin/exp) using "i" as the imaginary unit.'>
            <input type="radio" name={radioGroupName} checked={mode === "complex"} onChange={() => setCalculatorMode(storageKey, "complex")} /> Complex
          </label>
        </div>
      )}
      {mode === "units" && modulus === null && (
        <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>
          <strong>Units</strong> is for dimensional analysis: numbers carry a physical unit (m, s, kg, N, mi, km, ...),
          arithmetic tracks the combined unit, and <code>in</code> converts to a compatible unit -- e.g.{" "}
          <code>5 m/s * 3 s</code>, <code>9.8 m/s^2 * 70 kg in N</code>, <code>3 mi in km</code>. Stored variables are
          plain dimensionless numbers (the magnitude at assignment time), not unit-carrying values.
        </p>
      )}
      {mode === "interval" && modulus === null && (
        <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>
          <strong>Interval</strong> is for rigorous error bounds: instead of one (possibly rounded) float, every
          result comes back as a range guaranteed to contain the true value, e.g. <code>sqrt(2)</code> →{" "}
          <code>[1.4142135..., 1.4142135...]</code>. A named variable is treated as an exact point (its own stored
          value), not a range.
        </p>
      )}
      {mode === "complex" && modulus === null && (
        <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>
          <strong>Complex</strong> supports <code>+</code>, <code>-</code>, <code>*</code>, <code>/</code>,{" "}
          <code>^</code>, and elementary functions (<code>sqrt</code>, <code>sin</code>/<code>cos</code>/
          <code>tan</code>, <code>exp</code>, <code>ln</code>, hyperbolic and inverse variants, ...) over complex
          numbers, with <code>i</code> as the imaginary unit -- e.g. <code>i^2</code>, <code>(3+4i)*(1-2i)</code>,{" "}
          <code>sqrt(-1)</code>, <code>exp(i*pi)</code>. Two-argument functions (like <code>atan2</code>) aren't
          supported, and only real-valued results can be stored into a variable.
        </p>
      )}

      <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>
        Store a value in a variable with <code>=</code>, or directionally with <code>-&gt;</code>/<code>&lt;-</code>:{" "}
        <code>k = 3*r</code>, <code>3*r -&gt; k</code>, and <code>k &lt;- 3*r</code> all store the same value in{" "}
        <code>k</code>.
      </p>

      <div
        ref={historyRef}
        style={{
          border: "1px solid var(--border)",
          borderRadius: "6px",
          padding: "0.5rem 0.75rem",
          minHeight: "8rem",
          maxHeight: "20rem",
          overflowY: "auto",
          margin: "0.5rem 0",
          font: "0.9rem ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        }}
      >
        {state.history.length === 0 && (
          <p style={{ color: "var(--muted)", margin: 0 }}>
            Type an expression below, or "name = expr" (or "expr -&gt; name" / "name &lt;- expr") to save a value.
          </p>
        )}
        {state.history.map((entry, i) => (
          <div
            key={i}
            style={{ display: "flex", justifyContent: "space-between", gap: "1rem", padding: "0.15rem 0" }}
          >
            <span style={{ color: "var(--ink-soft)" }}>{entry.input}</span>
            <span style={{ color: entry.isError ? "var(--danger)" : entry.isAssignment ? "#2563eb" : "inherit", fontWeight: entry.isAssignment ? 600 : 400 }}>
              {/* Explicit "error:" prefix (mallory#305): a failed
                  line's message previously differed from a result only by
                  color, which reads as broken output rather than a labeled
                  failure (and not at all for colorblind users). */}
              {entry.isError ? `error: ${entry.display}` : entry.display}
            </span>
          </div>
        ))}
      </div>

      {state.history.length > 0 && (
        <div style={{ margin: "0.25rem 0" }}>
          {/* Clears the log only, not stored variables (issue #318) -- the
              history persists to localStorage and previously grew without
              any way to drop it (a stale error line from a past session
              could sit at the top of a "fresh" calculator forever). */}
          <button type="button" onClick={() => clearCalculatorHistory(storageKey)} style={{ fontSize: "0.8rem" }}>
            Clear history
          </button>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span style={{ color: "#2563eb" }}>{"›"}</span>
        <input
          value={input}
          onChange={(e) => setCalculatorInput(storageKey, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitCalculatorInput(storageKey);
          }}
          placeholder='log(100) + r, or  k = 3*r, or 3*r -> k'
          style={{ flex: 1, font: "inherit", padding: "0.3rem 0.4rem" }}
          autoComplete="off"
        />
      </div>

      {variableNames.length > 0 && (
        <p style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "0.5rem" }}>
          Defined: {variableNames.map((name) => `${name} = ${state.variables[name]}`).join(", ")}
        </p>
      )}
    </div>
  );
}
