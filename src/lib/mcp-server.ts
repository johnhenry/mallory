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
 * `createServerFn` exports). Write tools (save/set a document's cells)
 * are explicitly NOT included here -- true CellGraph-level session tools
 * (matching `useCellGraphTools`'s live get/set/list contract) need the
 * app's reactive compute graph running server-side with no DOM, a
 * materially bigger project than block-level gallery read access;
 * tracked as a follow-up rather than half-built into this ticket.
 *
 * A fresh `McpServer` is built per HTTP request (see
 * `src/routes/api.mcp.ts`), matching the MCP SDK's own documented
 * stateless-mode example (`examples/server/simpleStatelessStreamableHttp.js`):
 * `buildServer()`'s own doc comment already commits to "Stateless per
 * call (v1): no sessions, no notebook state, nothing to leak between
 * calls" for its own tools, so per-request server construction costs
 * nothing extra to keep consistent.
 */
import { buildServer } from "mallory-mcp";
import { z } from "zod";
import { GALLERY_SEEDS } from "./gallery-seeds.ts";
import { getGalleryDb, getSavedGraphRecordState, listSavedGraphRecords, mergeGallerySummaries } from "./saved-graphs.ts";

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

  return server;
}
