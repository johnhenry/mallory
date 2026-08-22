/**
 * Server-side MCP endpoint (issue #40 item 1): mounts mallory-mcp's
 * `buildServer()` (9 stateless math tools -- symbolic_parse/simplify/
 * differentiate/integrate/solve/evaluate, linalg_solve, tensor_pipeline,
 * stats_summary) plus two read-only "graph-session" tools on top
 * (gallery_list/gallery_get), so an *external* agent gets the math
 * toolbox and can browse saved sessions without a browser -- WebMCP
 * (`useCellGraphTools`) requires being in the page; this doesn't.
 *
 * Read-only by design: `gallery_list`/`gallery_get` return the exact same
 * data as the Gallery UI's own `listSavedGraphs`/`getSavedGraph`
 * server functions (same auth posture -- currently none, matching the
 * issue's own note that this is gated at the Cloudflare Access/domain
 * layer, not the app). They call the lower-level, non-`createServerFn`
 * primitives (`getGalleryDb`/`listSavedGraphRecords`/
 * `mergeGallerySummaries`/`getSavedGraphRecordState`) instead of
 * `listSavedGraphs`/`getSavedGraph` directly, for a real reason found
 * empirically: `createServerFn`-wrapped functions read TanStack Start's
 * request-scoped `AsyncLocalStorage` context, which only exists while a
 * real request is flowing through the framework's own server pipeline --
 * calling them from a plain `node:test` process throws "No Start context
 * found in AsyncLocalStorage" even though the exact same call succeeds
 * inside a live server route handler. The lower-level primitives have no
 * such dependency (same precedent `saved-graphs.test.ts` already
 * established: it tests these primitives directly, never the wrapped
 * `createServerFn` exports).
 *
 * A write tool, `gallery_save` (issue #163 item 1), is gated OFF by
 * default behind `MALLORY_GRAPH_ENABLE_MCP_WRITE=1` (the `llmtm` hub's
 * `LLMTM_HUB_ENABLE_*` convention -- a server-side write path this app
 * otherwise has no auth in front of beyond whatever gates the domain
 * itself) and only registered on the server when the env var is set, so
 * an agent probing `tools/list` on a default deployment never even sees
 * it exists. True CellGraph-level session tools (matching
 * `useCellGraphTools`'s live get/set/list contract) are NOT included
 * here -- that needs the app's reactive compute graph running
 * server-side with no DOM, a materially bigger project than block-level
 * gallery read/write; issue #163 item 2's own text calls for a
 * feasibility spike first, not a build (see
 * `cell-graph-headless-spike.test.ts`).
 *
 * A fresh `McpServer` is built per HTTP request (see
 * `src/routes/api.mcp.ts`), matching the MCP SDK's own documented
 * stateless-mode example (`examples/server/simpleStatelessStreamableHttp.js`):
 * `buildServer()`'s own doc comment already commits to "Stateless per
 * call (v1): no sessions, no notebook state, nothing to leak between
 * calls" for its own tools, so per-request server construction costs
 * nothing extra to keep consistent.
 */
import { buildServer } from "@johnhenry/math-plus-mcp";
import { z } from "zod";
import { GALLERY_SEEDS } from "./gallery-seeds.ts";
import {
  getGalleryDb,
  getSavedGraphRecordState,
  insertSavedGraphRecord,
  listSavedGraphRecords,
  mergeGallerySummaries,
  type SavedGraphKind,
  type SavedGraphState,
} from "./saved-graphs.ts";

const SAVED_GRAPH_KINDS: SavedGraphKind[] = [
  "multi",
  "notebook",
  "geometry",
  "surface-3d",
  "ode",
  "ode-system",
  "regression",
  "statistics",
  "systems",
  "complex",
];

/** `llmtm` hub's `LLMTM_HUB_ENABLE_*` convention: an explicit opt-in env var, default OFF. */
export function isMcpWriteEnabled(): boolean {
  return process.env.MALLORY_GRAPH_ENABLE_MCP_WRITE === "1";
}

function ok(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

function err(e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

/** `buildServer()` plus the graph-session tools -- see this module's doc comment for what's read-only-by-design and what's deferred. */
export function buildGraphSessionServer() {
  const server = buildServer();

  server.registerTool(
    "gallery_list",
    {
      description:
        "List every saved graph/notebook session in the Gallery (both user-saved documents and the built-in curated seeds), newest first. Each entry has an id, title, kind, and createdAt -- use gallery_get with an id to read a session's full state.",
      inputSchema: {},
    },
    async () => {
      try {
        const db = await getGalleryDb();
        return ok(mergeGallerySummaries(listSavedGraphRecords(db)));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    "gallery_get",
    {
      description: "Read a saved graph/notebook session's full state by id (from gallery_list). Returns the exact SavedGraphState JSON the panel itself would hydrate from.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      try {
        const seed = GALLERY_SEEDS.find((s) => s.id === id);
        if (seed) return ok(seed.state);
        const db = await getGalleryDb();
        const state = getSavedGraphRecordState(db, id);
        if (state === undefined) throw new Error("Unknown or deleted saved graph.");
        return ok(state);
      } catch (e) {
        return err(e);
      }
    },
  );

  if (isMcpWriteEnabled()) {
    server.registerTool(
      "gallery_save",
      {
        description:
          "Save a new graph/notebook session to the Gallery, returning its id. DISABLED by default -- only present when the server has MALLORY_GRAPH_ENABLE_MCP_WRITE=1 set. `state` must be the exact SavedGraphState JSON shape for `kind` (the same shape gallery_get returns for an existing session of that kind).",
        inputSchema: {
          title: z.string(),
          kind: z.enum(SAVED_GRAPH_KINDS as [SavedGraphKind, ...SavedGraphKind[]]),
          state: z.record(z.string(), z.unknown()),
        },
      },
      async ({ title, kind, state }) => {
        try {
          const db = await getGalleryDb();
          const id = crypto.randomUUID();
          insertSavedGraphRecord(db, { id, title: title.trim() || "Untitled", kind, createdAt: Date.now(), state: state as unknown as SavedGraphState });
          return ok({ id });
        } catch (e) {
          return err(e);
        }
      },
    );
  }

  return server;
}
