import { CellGraph } from "./cell-graph.ts";

/**
 * The app-global workspace CellGraph (issue #42) -- ONE instance shared by
 * every mounted panel, unlike every other `new CellGraph()` call site in
 * this codebase (29 of them, all per-component-instance via `useRef`/lazy
 * `useState`, some shared only via prop-threading an `externalGraph` down
 * to sibling panes -- see e.g. `LinkedGraphPanes.tsx`). This is the first
 * module-level singleton in the codebase; no prior file holds a lazily-
 * constructed stateful instance at module scope (the closest precedent,
 * `webmcp-agent-mode.ts`, is stateless -- it reads/writes `localStorage`
 * on every call rather than caching an object).
 *
 * SSR-safe by NOT caching on the server: `typeof window === "undefined"`
 * returns a fresh throwaway `CellGraph` every call, so no state leaks
 * across requests (the same isolation every other panel's per-render
 * `CellGraph` already gets, just made explicit here since this one WOULD
 * otherwise persist across requests if cached unconditionally at module
 * scope on the server).
 */
let clientInstance: CellGraph | null = null;

export function getWorkspaceGraph(): CellGraph {
  if (typeof window === "undefined") return new CellGraph();
  if (!clientInstance) clientInstance = new CellGraph();
  return clientInstance;
}
