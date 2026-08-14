import { NonLinearSystemError, Symbolic } from "mallory-math";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsSystem, type CellIdsSystem } from "../lib/cell-ids.ts";
import { equationToImplicitZero } from "../lib/equation-to-zero.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { preprocessImplicitMultiplication } from "../lib/implicit-mult.ts";
import { DEFAULT_SYSTEM_STATE, decodeSystemState, encodeSystemState, type SystemState } from "../lib/system-state.ts";
import { saveGraph } from "../lib/saved-graphs.ts";
import { useCell } from "../lib/use-cell.ts";

type SolutionResult =
  | { ok: true; values: Record<string, number>; method: "exact" | "numeric" }
  | { ok: false; message: string };

/** Writes a state's fields onto `graph`'s free cells -- shared by useSystemGraph's own hydrate-from-hash and a notebook block's post-mount overwrite. */
export function seedSystemState(graph: CellGraph, ids: CellIdsSystem, state: SystemState): void {
  graph.set(ids.equations, state.equations);
  graph.set(ids.variables, state.variables);
}

/** Builds the full serializable state of a system-solver panel -- shared by the URL-sync effect and the save-to-gallery handler. */
export function getCurrentSystemState(graph: CellGraph, ids: CellIdsSystem): SystemState {
  return {
    v: 1,
    equations: graph.get<string[]>(ids.equations),
    variables: graph.get<string>(ids.variables),
  };
}

/**
 * Sets up a system-solver pane's reactive cells -- a different input shape
 * entirely from GraphCanvas's single expression + axis variable (N equation
 * strings + a variable-name list), so it isn't woven into
 * `cellIds`/`useExpressionGraph` at all. Shares an `externalGraph` when
 * supplied instead of creating a private one, mirroring OdePanel's
 * `useOdeGraph`.
 */
function useSystemGraph(cellId: string, externalGraph?: CellGraph): CellGraph {
  const ref = useRef<CellGraph | null>(null);
  if (!ref.current) {
    const graph = externalGraph ?? new CellGraph();
    const ids = cellIdsSystem(cellId);
    if (!graph.has(ids.equations)) {
      const decoded = !externalGraph && typeof window !== "undefined" ? decodeSystemState(window.location.hash.slice(1)) : null;
      seedSystemState(graph, ids, decoded ?? DEFAULT_SYSTEM_STATE);

      // Deliberate deviation from the "keep last good value on error" pattern
      // used by GraphCanvas's sampling cells: this surfaces the actual thrown
      // error message (NonLinearSystemError/SingularSystemError/etc.) rather
      // than a stale solution. Solving is a discrete action, not a continuous
      // typing target -- *why* it failed is the useful output here, not a
      // flicker-free canvas.
      graph.define(ids.solution, (): SolutionResult => {
        const equations = graph.get<string[]>(ids.equations);
        const variablesText = graph.get<string>(ids.variables);
        const variables = variablesText
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean);
        const exprs = equations.map((eq) => preprocessImplicitMultiplication(equationToImplicitZero(eq)));
        try {
          const values = Symbolic.solveSystem(exprs, variables);
          return { ok: true, values, method: "exact" };
        } catch (e) {
          if (!(e instanceof NonLinearSystemError)) {
            return { ok: false, message: e instanceof Error ? e.message : String(e) };
          }
        }
        // Nonlinear -- fall back to the damped-Newton numeric solver (never
        // throws NonLinearSystemError itself; only finds one root near its
        // default initial guess, so a genuinely bad guess or a system with
        // multiple solutions can still fail/pick an unexpected root).
        try {
          const values = Symbolic.solveSystemNumeric(exprs, variables);
          return { ok: true, values, method: "numeric" };
        } catch (e) {
          return { ok: false, message: e instanceof Error ? e.message : String(e) };
        }
      });
    }
    ref.current = graph;
  }
  return ref.current;
}

export interface SystemSolverPanelProps {
  cellId?: string;
  /** Share an existing CellGraph (e.g. from a notebook block) instead of creating a private one. */
  graph?: CellGraph;
  /** Hydrate from and write to the URL fragment. Off for a notebook-embedded instance, whose document owns persistence instead. */
  syncUrl?: boolean;
}

/** N equations in N variables -- Symbolic.solveSystem itself is already N-safe; this just adds add/remove-row UI on top. */
export function SystemSolverPanel({ cellId = "system-1", graph: externalGraph, syncUrl = true }: SystemSolverPanelProps = {}) {
  const graph = useSystemGraph(cellId, externalGraph);
  // Namespaced by cellId, same collision-avoidance fix as OdePanel's.
  useCellGraphTools(`data_systems_${cellId}`, graph);
  const ids = cellIdsSystem(cellId);
  const equations = useCell<string[]>(graph, ids.equations);
  const variablesText = useCell<string>(graph, ids.variables);
  const solution = useCell<SolutionResult>(graph, ids.solution);
  const [equationInputs, setEquationInputs] = useState(equations);
  const [variablesInput, setVariablesInput] = useState(variablesText);
  // Keeps the input boxes in sync when equations/variablesText change for a
  // reason other than typing in these boxes -- e.g. URL-hash hydration --
  // mirrors GraphCanvas's identically-reasoned effect.
  useEffect(() => {
    setEquationInputs(equations);
  }, [equations]);
  useEffect(() => {
    setVariablesInput(variablesText);
  }, [variablesText]);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const saveGraphFn = useServerFn(saveGraph);

  async function handleSave() {
    const title = window.prompt("Title for this saved system:", "Untitled");
    if (title === null) return;
    setSaveStatus("Saving…");
    try {
      await saveGraphFn({ data: { title, kind: "systems", state: getCurrentSystemState(graph, ids) } });
      setSaveStatus(`Saved as "${title || "Untitled"}" — see the gallery to reopen it.`);
    } catch (e) {
      setSaveStatus(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Keep the URL fragment in sync with the live graph state, mirroring OdePanel's pattern.
  useEffect(() => {
    if (!syncUrl) return;
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeSystemState(getCurrentSystemState(graph, ids))}`);
    }
    writeUrl();
    return graph.subscribeAll(writeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, syncUrl]);

  function updateEquation(i: number, value: string) {
    const next = equationInputs.map((eq, idx) => (idx === i ? value : eq));
    setEquationInputs(next);
    graph.set(ids.equations, next);
  }

  function addEquation() {
    const next = [...equationInputs, ""];
    setEquationInputs(next);
    graph.set(ids.equations, next);
  }

  function removeEquation(i: number) {
    const next = equationInputs.filter((_, idx) => idx !== i);
    setEquationInputs(next);
    graph.set(ids.equations, next);
  }

  function updateVariables(value: string) {
    setVariablesInput(value);
    graph.set(ids.variables, value);
  }

  return (
    <div>
      {equationInputs.map((eq, i) => (
        <div key={i} style={{ margin: "0.25rem 0", display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
          <label>
            Equation {i + 1} (= 0 implicitly, or write "= value"):{" "}
            <input
              value={eq}
              onChange={(e) => updateEquation(i, e.target.value)}
              style={{ font: "inherit", width: "28ch" }}
            />
          </label>
          <button
            type="button"
            onClick={() => removeEquation(i)}
            disabled={equationInputs.length <= 1}
            aria-label="Remove equation"
            title="Remove equation"
          >
            ✕
          </button>
        </div>
      ))}
      <button type="button" onClick={addEquation} style={{ margin: "0.25rem 0" }}>
        + Add equation
      </button>
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          Variables (comma-separated):{" "}
          <input
            value={variablesInput}
            onChange={(e) => updateVariables(e.target.value)}
            style={{ font: "inherit", width: "12ch" }}
          />
        </label>
      </div>
      <div style={{ margin: "0.5rem 0" }}>
        {solution.ok ? (
          <>
            <ul>
              {Object.entries(solution.values).map(([name, value]) => (
                <li key={name}>
                  {name} = {value.toFixed(4)}
                </li>
              ))}
            </ul>
            {solution.method === "numeric" && (
              <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
                Solved numerically (the system isn't linear) -- finds one nearby root, not necessarily every solution.
              </p>
            )}
          </>
        ) : (
          <p style={{ color: "var(--danger)" }}>{solution.message}</p>
        )}
      </div>
      {syncUrl && (
        <div style={{ margin: "0.5rem 0" }}>
          <button type="button" onClick={handleSave}>
            Save to gallery
          </button>
          {saveStatus && <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>{saveStatus}</p>}
        </div>
      )}
    </div>
  );
}
