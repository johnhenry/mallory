import { useEffect, useRef, useState } from "react";
import {
  EMPTY_CALCULATOR_STATE,
  submitCalculatorLine,
  type CalculatorMode,
  type CalculatorState,
} from "../lib/calculator-eval.ts";
import { useModelContextTool } from "../hooks/use-model-context-tool.ts";

const STORAGE_KEY = "mallory-graph:calculator";

const STRUCTURE_OPTIONS: Array<{ label: string; modulus: number | null }> = [
  { label: "Real numbers", modulus: null },
  { label: "Z/2Z (GF(2))", modulus: 2 },
  { label: "Z/5Z", modulus: 5 },
  { label: "Z/7Z (GF(7))", modulus: 7 },
  { label: "Z/11Z", modulus: 11 },
];

function loadStoredState(storageKey: string): CalculatorState {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return EMPTY_CALCULATOR_STATE;
    const parsed = JSON.parse(raw);
    return {
      history: Array.isArray(parsed.history) ? parsed.history : [],
      variables: parsed.variables && typeof parsed.variables === "object" ? parsed.variables : {},
    };
  } catch {
    return EMPTY_CALCULATOR_STATE;
  }
}

/**
 * A REPL-style "just an answer" tool: type an expression, get a result, or
 * `name = expr` to name a value and reuse it in later lines. No plot/
 * viewport (that's what Graphing is for) -- unlike every other panel in
 * this app, it needs no CellGraph (nothing else derives from its state) and
 * persists to `localStorage` rather than a URL hash or the server-backed
 * Gallery, since a scratch calculation isn't the kind of thing worth a
 * shareable link (mallory-graph's SPA-shell pass).
 *
 * `instanceId` (issue #255's notebook calculator block) scopes both the
 * `localStorage` key and the two WebMCP tool names below it -- omitted
 * (the standalone `/calculator` route's own call site) preserves the
 * original fixed key/names exactly, so existing saved history and any
 * external tooling built against `calculator_evaluate` keep working
 * unchanged. Passed (a notebook block's own `blockId`) gives each block its
 * own independent scratch history and its own uniquely-named tools -- the
 * same `${prefix}_${cellId}`-scoping convention every *other* embeddable
 * panel already uses (see e.g. `useCellGraphTools`'s callers), which this
 * panel had never needed before because it was never embeddable. Without
 * this, two calculator blocks in one notebook (or a block alongside the
 * standalone page) would silently share one history and collide on tool
 * registration -- confirmed a real gap during the issue #255 audit, not a
 * hypothetical.
 */
export function CalculatorPanel({ instanceId }: { instanceId?: string } = {}) {
  const storageKey = instanceId ? `${STORAGE_KEY}:${instanceId}` : STORAGE_KEY;
  const toolPrefix = instanceId ? `calculator_${instanceId}` : "calculator";
  const [state, setState] = useState<CalculatorState>(() => loadStoredState(storageKey));
  const [mode, setMode] = useState<CalculatorMode>("float");
  const [modulus, setModulus] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const historyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(state));
  }, [state, storageKey]);

  useEffect(() => {
    const el = historyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.history.length]);

  function handleSubmit() {
    if (!input.trim()) return;
    setState((s) => submitCalculatorLine(input, s, mode, modulus));
    setInput("");
  }

  const variableNames = Object.keys(state.variables);

  // Wraps the same submitCalculatorLine the Enter key uses -- an agent's
  // evaluation is indistinguishable from one typed in the UI, including
  // being appended to the same persisted history.
  useModelContextTool({
    name: `${toolPrefix}_evaluate`,
    description: 'Evaluate an expression, or "name = expr" to save a value for later expressions to reference. Uses the calculator\'s current mode (Float/Exact/GF(n)).',
    inputSchema: {
      type: "object",
      properties: {
        expression: { type: "string", description: 'e.g. "12 * (4 + 1/3)" or "r = sqrt(2)"' },
      },
      required: ["expression"],
    },
    // Reads `state` directly and computes `next` before calling `setState`,
    // rather than extracting values from inside a setState *updater*
    // function -- a WebMCP tool's `execute` runs outside any React event
    // handler, so (confirmed live: state persisted correctly to
    // localStorage, but a value captured *inside* the updater read back as
    // still-undefined immediately after the setState call) the updater
    // isn't guaranteed to run synchronously in that context the way it does
    // from a DOM event handler. Computing `next` up front sidesteps the
    // question entirely.
    handler: (input: Record<string, unknown>) => {
      const expression = String(input.expression ?? "");
      const next = submitCalculatorLine(expression, state, mode, modulus);
      const entry = next.history[next.history.length - 1];
      if (!entry) throw new Error("Empty expression.");
      setState(next);
      if (entry.isError) throw new Error(entry.display);
      return { result: entry.display, isAssignment: entry.isAssignment, variables: next.variables };
    },
  });

  useModelContextTool({
    name: `${toolPrefix}_set_mode`,
    description:
      'Set the calculator\'s arithmetic mode: "float", "exact" (fractions), "units" (dimensional analysis, e.g. "5 m/s * 3 s"), "interval" (rigorous bounds, e.g. "sqrt(2)" -> "[1.414..., 1.414...]"), or a finite structure Z/nZ via modulus (2, 5, 7, or 11).',
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["float", "exact", "units", "interval"], description: "Ignored when modulus is set." },
        modulus: { type: ["number", "null"], description: "One of 2, 5, 7, 11 for Z/nZ, or null (or omit) for real numbers." },
      },
    },
    handler: (input: Record<string, unknown>) => {
      if (input.modulus !== undefined && input.modulus !== null) {
        const m = Number(input.modulus);
        if (![2, 5, 7, 11].includes(m)) throw new Error("modulus must be one of 2, 5, 7, 11.");
        setModulus(m);
      } else if (input.modulus === null) {
        setModulus(null);
      }
      if (input.mode === "float" || input.mode === "exact" || input.mode === "units" || input.mode === "interval") setMode(input.mode);
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
            setModulus(v === "real" ? null : Number(v));
          }}
        >
          {STRUCTURE_OPTIONS.map((opt) => (
            <option key={opt.label} value={opt.modulus === null ? "real" : String(opt.modulus)}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
      {modulus === null && (
        <div role="radiogroup" aria-label="Arithmetic mode" style={{ margin: "0.5rem 0" }}>
          <label>
            <input type="radio" name="calc-mode" checked={mode === "float"} onChange={() => setMode("float")} /> Float
          </label>{" "}
          <label>
            <input type="radio" name="calc-mode" checked={mode === "exact"} onChange={() => setMode("exact")} /> Exact
          </label>{" "}
          <label>
            <input type="radio" name="calc-mode" checked={mode === "units"} onChange={() => setMode("units")} /> Units
          </label>{" "}
          <label>
            <input type="radio" name="calc-mode" checked={mode === "interval"} onChange={() => setMode("interval")} /> Interval
          </label>
        </div>
      )}
      {mode === "units" && modulus === null && (
        <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>
          e.g. <code>5 m/s * 3 s</code>, <code>9.8 m/s^2 * 70 kg in N</code>, <code>3 mi in km</code>
        </p>
      )}
      {mode === "interval" && modulus === null && (
        <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>
          Every result carries rigorous bounds, e.g. <code>sqrt(2)</code> → <code>[1.4142135..., 1.4142135...]</code>. A
          named variable is treated as an exact point (its own stored value), not a range.
        </p>
      )}

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
        {state.history.length === 0 && <p style={{ color: "#888", margin: 0 }}>Type an expression below, or "name = expr" to save a value.</p>}
        {state.history.map((entry, i) => (
          <div
            key={i}
            style={{ display: "flex", justifyContent: "space-between", gap: "1rem", padding: "0.15rem 0" }}
          >
            <span style={{ color: "#555" }}>{entry.input}</span>
            <span style={{ color: entry.isError ? "var(--danger)" : entry.isAssignment ? "#2563eb" : "inherit", fontWeight: entry.isAssignment ? 600 : 400 }}>
              {entry.display}
            </span>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span style={{ color: "#2563eb" }}>{"›"}</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
          }}
          placeholder='log(100) + r, or  k = 3*r'
          style={{ flex: 1, font: "inherit", padding: "0.3rem 0.4rem" }}
          autoComplete="off"
        />
      </div>

      {variableNames.length > 0 && (
        <p style={{ fontSize: "0.8rem", color: "#888", marginTop: "0.5rem" }}>
          Defined: {variableNames.map((name) => `${name} = ${state.variables[name]}`).join(", ")}
        </p>
      )}
    </div>
  );
}
