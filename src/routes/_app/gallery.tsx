import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { encodeComplexState, type ComplexState } from "~/lib/complex-state.ts";
import { encodeGeometryState, type GeometryState } from "~/lib/geometry-state.ts";
import { encodeLinked3DState, type Linked3DState } from "~/lib/linked3d-state.ts";
import { encodeMultiGraphState, type MultiGraphState } from "~/lib/multi-graph-state.ts";
import { encodeNotebookState, type NotebookState } from "~/lib/notebook-state.ts";
import { encodeOdeState, type OdeState } from "~/lib/ode-state.ts";
import { encodeOdeSystemState, type OdeSystemState } from "~/lib/ode-system-state.ts";
import { encodeRegressionState, type RegressionState } from "~/lib/regression-state.ts";
import { encodeStatisticsState, type StatisticsState } from "~/lib/statistics-state.ts";
import { encodeSystemState, type SystemState } from "~/lib/system-state.ts";
import { deleteSavedGraph, getSavedGraph, listSavedGraphs, type SavedGraphKind, type SavedGraphState, type SavedGraphSummary } from "~/lib/saved-graphs.ts";
import { createShortLink } from "~/lib/short-links.ts";

/** One reopen-href builder per SavedGraphKind -- the tab-hosted kinds (ode/ode-system, regression/statistics/systems) add a `?tab=` search param so CategoryTabs selects the right sibling before that panel's own decoder ever sees the hash (see CategoryTabs.tsx's `syncSearchParam`). */
const REOPEN_HREF: Record<SavedGraphKind, (state: SavedGraphState) => string> = {
  multi: (state) => `/graphing#${encodeMultiGraphState(state as MultiGraphState)}`,
  notebook: (state) => `/notes#${encodeNotebookState(state as NotebookState)}`,
  geometry: (state) => `/geo#${encodeGeometryState(state as GeometryState)}`,
  "surface-3d": (state) => `/3d#${encodeLinked3DState(state as Linked3DState)}`,
  ode: (state) => `/calculus?tab=ode#${encodeOdeState(state as OdeState)}`,
  "ode-system": (state) => `/calculus?tab=ode-system#${encodeOdeSystemState(state as OdeSystemState)}`,
  regression: (state) => `/data?tab=regression#${encodeRegressionState(state as RegressionState)}`,
  statistics: (state) => `/data?tab=statistics#${encodeStatisticsState(state as StatisticsState)}`,
  systems: (state) => `/data?tab=systems#${encodeSystemState(state as SystemState)}`,
  complex: (state) => `/graphing?tab=complex#${encodeComplexState(state as ComplexState)}`,
};

export const Route = createFileRoute("/_app/gallery")({
  component: GalleryPage,
});

/**
 * Lists every graph/notebook saved from either "Save to gallery" button --
 * GraphCanvasMulti's (now surfaced at `/graphing`) or NotebookPanel's (now
 * `/notes`). One shared, mixed-content gallery (see saved-graphs.ts's own
 * doc comment for why): each entry's `kind` says which route/encoder to
 * reopen it with.
 *
 * Moved under the `_app` shell during the SPA-shell pass (same URL,
 * `/gallery` -- a pathless layout route adds no path segment); reopen hrefs
 * retargeted from the legacy `/multi`/`/notebook` to the new `/graphing`/
 * `/notes` so a saved item lands on the new section instead of a legacy
 * page it would immediately banner away from (`GraphCanvasMulti`/
 * `NotebookPanel` only ever read/write `window.location.hash`, never their
 * own pathname, so this is safe).
 */
export function GalleryPage() {
  const listSavedGraphsFn = useServerFn(listSavedGraphs);
  const getSavedGraphFn = useServerFn(getSavedGraph);
  const deleteSavedGraphFn = useServerFn(deleteSavedGraph);
  const createShortLinkFn = useServerFn(createShortLink);
  const [entries, setEntries] = useState<SavedGraphSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shortLinkStatus, setShortLinkStatus] = useState<string | null>(null);

  useEffect(() => {
    listSavedGraphsFn()
      .then(setEntries)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [listSavedGraphsFn]);

  async function open(entry: SavedGraphSummary) {
    try {
      const state = await getSavedGraphFn({ data: { id: entry.id } });
      // A full navigation (not client-side routing) so the destination
      // route's mount-time hash read always runs fresh, rather than
      // depending on a hash-only change re-triggering it.
      window.location.href = REOPEN_HREF[entry.kind](state);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function remove(id: string) {
    await deleteSavedGraphFn({ data: { id } });
    setEntries((prev) => prev?.filter((e) => e.id !== id) ?? null);
  }

  /**
   * Reuses `REOPEN_HREF` to get the exact same encoded-state hash "open"
   * already builds (rather than duplicating each state codec's encode
   * call here), then hands just the hash portion to `createShortLink` --
   * short-links.ts stores that opaque string verbatim and doesn't need to
   * know how to encode/decode any particular panel's state shape.
   */
  async function copyShortLink(entry: SavedGraphSummary) {
    setShortLinkStatus("Creating short link…");
    try {
      const state = await getSavedGraphFn({ data: { id: entry.id } });
      const href = REOPEN_HREF[entry.kind](state);
      const encodedState = href.slice(href.indexOf("#") + 1);
      const { id } = await createShortLinkFn({ data: { kind: entry.kind, encodedState } });
      const shortUrl = `${window.location.origin}/s/${id}`;
      await navigator.clipboard.writeText(shortUrl);
      setShortLinkStatus(`Copied ${shortUrl} to the clipboard.`);
    } catch (e) {
      setShortLinkStatus(`Short link failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div>
      <div className="page-head">
        <p className="page-eyebrow">Gallery</p>
        <h1>Everything you've saved</h1>
        <p className="lede">
          Graphs and notebooks saved from the "Save to gallery" button on Graphing, Notebook, 3D & Surfaces,
          Geometry, Calculus, or Data & Algebra. Opening one reopens it fully editable.
        </p>
        <p className="lede" style={{ fontSize: "0.9rem" }}>
          <strong>What's saved:</strong> a snapshot of that panel's state (expressions, viewport, etc.) at the
          moment you clicked "Save to gallery" -- a copy, not a live link back to the panel, so later edits there
          don't change what's stored here. <strong>Retrieving it:</strong> click its title in the list below to
          reopen that snapshot on its original panel. <strong>Sharing it:</strong> "Copy short link" turns the same
          snapshot into a compact <code>/s/:id</code> URL that redirects straight to it -- useful because a saved
          item's own encoded URL can get very long. This gallery is one list shared by everyone who uses this app
          (not private to your browser); entries marked "Curated" are built-in examples that can't be deleted.
        </p>
      </div>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {entries === null && !error && <p>Loading…</p>}
      {entries?.length === 0 && <p>Nothing saved yet.</p>}
      {entries && entries.length > 0 && (
        <ul>
          {entries.map((entry) => (
            <li key={entry.id} style={{ margin: "0.25rem 0" }}>
              <button type="button" onClick={() => open(entry)} style={{ font: "inherit" }}>
                {entry.title}
              </button>{" "}
              <span
                style={{
                  fontSize: "0.75rem",
                  color: "#5b6b8c",
                  border: "1px solid #d7dfef",
                  borderRadius: "3px",
                  padding: "0 0.35rem",
                }}
              >
                {entry.kind}
              </span>{" "}
              <span style={{ color: "#5b6b8c", fontSize: "0.85rem" }}>{new Date(entry.createdAt).toLocaleString()}</span>{" "}
              <button type="button" onClick={() => copyShortLink(entry)} title="Copy a short /s/:id link that redirects here">
                Copy short link
              </button>{" "}
              {entry.readOnly ? (
                <span style={{ fontSize: "0.75rem", color: "var(--muted)" }} title="A curated gallery seed -- can't be deleted">
                  Curated
                </span>
              ) : (
                <button type="button" onClick={() => remove(entry.id)}>
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {shortLinkStatus && <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>{shortLinkStatus}</p>}
    </div>
  );
}
