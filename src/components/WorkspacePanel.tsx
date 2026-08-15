import { useEffect, useState } from "react";
import type { CellGraph } from "../lib/cell-graph.ts";
import { workspaceValueCellId } from "../lib/cell-ids.ts";
import { getWorkspaceGraph } from "../lib/workspace-graph.ts";
import { decodeWorkspaceState, encodeWorkspaceState, type WorkspaceState } from "../lib/workspace-state.ts";

interface WorkspaceVariable {
  name: string;
  value: number;
}

/**
 * Every genuinely user-set workspace variable, filtered from the singleton
 * graph's full cell list. Filtering matters: `GraphCanvas.tsx`'s
 * `computeParams` checks `workspace.hasValue(workspaceValueCellId(name))`
 * for every one of ITS OWN free variables on every recompute -- `hasValue`
 * is a pure, side-effect-free read (unlike `get()`, it never calls
 * `ensure()` and so never creates a phantom entry), which is exactly why
 * it's checked FIRST here rather than the notebook's own
 * `get()`-before-`hasValue()` ordering (see `notebookCurveCellId`'s doc
 * comment): that ordering only matters when the reader and the cell share
 * ONE `CellGraph` instance, so the read can register a same-graph
 * dependency edge for future reactivity. The workspace is a SEPARATE
 * instance from every panel's own graph, so no such edge is possible here
 * regardless of read order (see `GraphCanvas.tsx`'s subscription-bridge
 * `useEffect` for how reactivity is restored instead). Still: only
 * `role === "free"` cells (created via `set()`) are real workspace
 * variables a human or agent explicitly named -- a cell that only exists
 * because some `get()` elsewhere created it stays `role === "unknown"`
 * and is correctly excluded.
 */
function listWorkspaceVariables(graph: CellGraph): WorkspaceVariable[] {
  const prefix = "workspace:";
  return graph
    .list()
    .filter((c) => c.id.startsWith(prefix) && c.role === "free")
    .map((c) => ({ name: c.id.slice(prefix.length), value: graph.get<number>(c.id) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function useWorkspaceVariables(graph: CellGraph): WorkspaceVariable[] {
  const [, forceRender] = useState(0);
  useEffect(() => graph.subscribeAll(() => forceRender((n) => n + 1)), [graph]);
  return listWorkspaceVariables(graph);
}

/**
 * The `/workspace` inspector for issue #42's app-global workspace: every
 * named variable currently `set()` on the singleton workspace `CellGraph`
 * (see `workspace-graph.ts`), editable/removable here, plus a form to add
 * new ones. The WebMCP tools that make this agent-visible are registered
 * once at the app shell (`_app.tsx`), not here -- an agent needs write
 * access to the workspace regardless of whether a human has this page open.
 *
 * NOT in this v1 (see issue #42's remaining scope after this ships):
 * "which panels read it" (would need `CellGraph` to expose a cell's
 * `dependents` set through a public API -- it currently doesn't, and that's
 * a change to the shared reactive core, not this UI-only pass); rolling the
 * workspace-fallback free-variable check out beyond `GraphCanvas.tsx` (the
 * first consumer) to every other panel.
 */
export function WorkspacePanel() {
  const graph = getWorkspaceGraph();
  const variables = useWorkspaceVariables(graph);
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("1");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const decoded = typeof window !== "undefined" ? decodeWorkspaceState(window.location.hash.slice(1)) : null;
    if (!decoded) return;
    // Additive: merges this page's saved variables into the shared singleton
    // rather than wiping it -- another already-mounted panel (or an agent)
    // may have already set workspace variables this page's own hash knows
    // nothing about, and those must survive a /workspace page load.
    for (const v of decoded.variables) graph.set(workspaceValueCellId(v.name), v.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function writeUrl() {
      const state: WorkspaceState = { v: 1, variables: listWorkspaceVariables(graph) };
      window.history.replaceState(null, "", `#${encodeWorkspaceState(state)}`);
    }
    writeUrl();
    return graph.subscribeAll(writeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  function addVariable(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) {
      setError("Enter a name.");
      return;
    }
    const value = Number(newValue);
    if (!Number.isFinite(value)) {
      setError("Value must be a number.");
      return;
    }
    graph.set(workspaceValueCellId(name), value);
    setNewName("");
    setNewValue("1");
    setError(null);
  }

  return (
    <div>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
        Named variables here are available as free variables on every panel, app-wide -- e.g. a workspace variable named "k" makes "k" resolve
        automatically anywhere "k" appears in an expression, instead of getting its own local slider.
      </p>
      {variables.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>No workspace variables yet.</p>
      ) : (
        <table style={{ borderCollapse: "collapse", margin: "0.5rem 0" }}>
          <thead>
            <tr>
              <th style={{ border: "1px solid var(--border)", padding: "0.2rem 0.5rem", textAlign: "left" }}>name</th>
              <th style={{ border: "1px solid var(--border)", padding: "0.2rem 0.5rem", textAlign: "left" }}>value</th>
              <th style={{ border: "1px solid var(--border)", padding: "0.2rem 0.5rem" }} />
            </tr>
          </thead>
          <tbody>
            {variables.map((v) => (
              <tr key={v.name}>
                <td style={{ border: "1px solid var(--border)", padding: "0.2rem 0.5rem", fontFamily: "monospace" }}>{v.name}</td>
                <td style={{ border: "1px solid var(--border)", padding: "0.2rem 0.5rem" }}>
                  <input
                    type="number"
                    value={v.value}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      if (Number.isFinite(value)) graph.set(workspaceValueCellId(v.name), value);
                    }}
                    style={{ font: "inherit", width: "10ch" }}
                  />
                </td>
                <td style={{ border: "1px solid var(--border)", padding: "0.2rem 0.5rem" }}>
                  <button type="button" onClick={() => graph.delete(workspaceValueCellId(v.name))}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form onSubmit={addVariable} style={{ display: "flex", gap: "0.5rem", alignItems: "center", margin: "0.5rem 0" }}>
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="name" style={{ font: "inherit", width: "10ch" }} />
        <input
          type="number"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          placeholder="value"
          style={{ font: "inherit", width: "10ch" }}
        />
        <button type="submit">+ Add variable</button>
      </form>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
    </div>
  );
}
