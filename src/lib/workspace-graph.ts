import { CellGraph } from "./cell-graph.ts";
import { workspaceValueCellId } from "./cell-ids.ts";

export interface WorkspaceVariable {
  name: string;
  value: number;
}

/**
 * Every genuinely user-set workspace variable, filtered from the singleton
 * graph's full cell list. Only `role === "free"` cells (created via
 * `set()`) are real workspace variables a human or agent explicitly
 * named -- a cell that only exists because some `get()`/`hasValue()`
 * elsewhere created a phantom entry stays `role === "unknown"` and is
 * correctly excluded. Lives here (not in WorkspacePanel) since issue #310:
 * the localStorage persistence below needs the same filter, and the panel
 * imports it from here.
 */
export function listWorkspaceVariables(graph: CellGraph): WorkspaceVariable[] {
  const prefix = "workspace:";
  return graph
    .list()
    .filter((c) => c.id.startsWith(prefix) && c.role === "free")
    .map((c) => ({ name: c.id.slice(prefix.length), value: graph.get<number>(c.id) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const STORAGE_KEY = "mallory-graph:workspace";

function loadStoredVariables(): WorkspaceVariable[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is WorkspaceVariable => typeof v?.name === "string" && typeof v?.value === "number" && Number.isFinite(v.value));
  } catch {
    return [];
  }
}

/**
 * The app-global workspace CellGraph (issue #42) -- ONE instance shared by
 * every mounted panel, unlike every other `new CellGraph()` call site in
 * this codebase (all per-component-instance). This is the codebase's one
 * module-level stateful singleton.
 *
 * Persisted to localStorage (issue #310): the previous in-memory-only
 * singleton survived SPA navigation but died on ANY full document load
 * (refresh, direct URL entry, opening the site tomorrow) -- and the
 * /workspace page's URL-fragment write couldn't help, since the fragment
 * belongs to the page you LEFT, not the one you come back on. That made
 * the feature's whole documented purpose ("define once, read from the
 * Compare tab and the 3D 2D-pane later") unreliable in exactly the
 * define-here-use-there flows it exists for. Variables now hydrate from
 * localStorage when the singleton is first built and save back on every
 * change (subscribeAll covers both `set` and `delete`).
 *
 * SSR-safe by NOT caching on the server: `typeof window === "undefined"`
 * returns a fresh throwaway `CellGraph` every call, so no state leaks
 * across requests.
 */
let clientInstance: CellGraph | null = null;

export function getWorkspaceGraph(): CellGraph {
  if (typeof window === "undefined") return new CellGraph();
  if (!clientInstance) {
    const graph = new CellGraph();
    for (const v of loadStoredVariables()) graph.set(workspaceValueCellId(v.name), v.value);
    graph.subscribeAll(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(listWorkspaceVariables(graph)));
      } catch {
        // Quota/privacy-mode failures just lose persistence, never break the live graph.
      }
    });
    clientInstance = graph;
  }
  return clientInstance;
}
