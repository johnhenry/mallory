import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { encodeComplexState, type ComplexState } from "~/lib/complex-state.ts";
import { encodeGeometryState, type GeometryState } from "~/lib/geometry-state.ts";
import { encodeLinked3DState, type Linked3DState } from "~/lib/linked3d-state.ts";
import { deleteLocalSave, listLocalSaves, type LocalSaveRecord } from "~/lib/local-saves.ts";
import { encodeMultiGraphState, type MultiGraphState } from "~/lib/multi-graph-state.ts";
import { encodeNotebookState, type NotebookState } from "~/lib/notebook-state.ts";
import { encodeOdeState, type OdeState } from "~/lib/ode-state.ts";
import { encodeOdeSystemState, type OdeSystemState } from "~/lib/ode-system-state.ts";
import { encodeRegressionState, type RegressionState } from "~/lib/regression-state.ts";
import { encodeStatisticsState, type StatisticsState } from "~/lib/statistics-state.ts";
import { encodeSystemState, type SystemState } from "~/lib/system-state.ts";
import { deleteSavedGraph, getSavedGraph, listSavedGraphs, saveGraph, type SavedGraphKind, type SavedGraphState, type SavedGraphSummary } from "~/lib/saved-graphs.ts";
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

const KIND_CHIP_STYLE = {
  fontSize: "0.75rem",
  color: "#5b6b8c",
  border: "1px solid #d7dfef",
  borderRadius: "3px",
  padding: "0 0.35rem",
} as const;

/**
 * Two sections since #320 step 3's local-first split:
 *
 * - **My saves** -- this browser's localStorage (see local-saves.ts). Every
 *   panel's "Save" button now writes here: private to this device, survives
 *   server redeploys, works offline. Each entry can be reopened, deleted,
 *   short-linked, or explicitly published to the shared gallery below.
 * - **Shared gallery** -- the server store (saved-graphs.ts): one list
 *   visible to everyone who uses this app, populated only by the explicit
 *   "Publish" action here (plus the compiled-in curated seeds). Still
 *   deploy-ephemeral -- no persistent volume is mounted, so published
 *   entries and short links are cleared whenever the app is redeployed.
 *
 * Reopen hrefs are built from `REOPEN_HREF` for both sections -- a local
 * save and a shared save of the same kind produce the identical URL, and
 * that URL (the full encoded-state link) remains the one truly durable way
 * to keep something.
 */
export function GalleryPage() {
  const listSavedGraphsFn = useServerFn(listSavedGraphs);
  const getSavedGraphFn = useServerFn(getSavedGraph);
  const deleteSavedGraphFn = useServerFn(deleteSavedGraph);
  const saveGraphFn = useServerFn(saveGraph);
  const createShortLinkFn = useServerFn(createShortLink);
  // Local saves are read in an effect (not a lazy useState initializer) so
  // the SSR pass and the client's first render agree on "null = loading" --
  // reading localStorage during render would make the two disagree.
  const [localSaves, setLocalSaves] = useState<LocalSaveRecord[] | null>(null);
  const [entries, setEntries] = useState<SavedGraphSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setLocalSaves(listLocalSaves());
    listSavedGraphsFn()
      .then(setEntries)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [listSavedGraphsFn]);

  function openState(kind: SavedGraphKind, state: SavedGraphState) {
    // A full navigation (not client-side routing) so the destination
    // route's mount-time hash read always runs fresh, rather than
    // depending on a hash-only change re-triggering it.
    window.location.href = REOPEN_HREF[kind](state);
  }

  async function openShared(entry: SavedGraphSummary) {
    try {
      openState(entry.kind, await getSavedGraphFn({ data: { id: entry.id } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function removeShared(id: string) {
    await deleteSavedGraphFn({ data: { id } });
    setEntries((prev) => prev?.filter((e) => e.id !== id) ?? null);
  }

  function removeLocal(id: string) {
    deleteLocalSave(id);
    setLocalSaves(listLocalSaves());
  }

  /** The explicit publish action the panels' "Save" buttons no longer perform implicitly -- a straight pass-through of the local record to the server store (same shape by design, see local-saves.ts). The local copy stays; publishing is a copy, not a move. */
  async function publish(record: LocalSaveRecord) {
    setStatus(`Publishing "${record.title}"…`);
    try {
      await saveGraphFn({ data: { title: record.title, kind: record.kind, state: record.state } });
      setStatus(`Published "${record.title}" to the shared gallery (your private copy is kept).`);
      setEntries(await listSavedGraphsFn());
    } catch (e) {
      setStatus(`Publish failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Reuses `REOPEN_HREF` to get the exact same encoded-state hash "open"
   * already builds (rather than duplicating each state codec's encode
   * call here), then hands just the hash portion to `createShortLink` --
   * short-links.ts stores that opaque string verbatim and doesn't need to
   * know how to encode/decode any particular panel's state shape.
   */
  async function copyShortLinkFor(kind: SavedGraphKind, state: SavedGraphState) {
    setStatus("Creating short link…");
    try {
      const href = REOPEN_HREF[kind](state);
      const encodedState = href.slice(href.indexOf("#") + 1);
      const { id } = await createShortLinkFn({ data: { kind, encodedState } });
      const shortUrl = `${window.location.origin}/s/${id}`;
      await navigator.clipboard.writeText(shortUrl);
      setStatus(`Copied ${shortUrl} to the clipboard.`);
    } catch (e) {
      setStatus(`Short link failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function copyShortLinkShared(entry: SavedGraphSummary) {
    try {
      await copyShortLinkFor(entry.kind, await getSavedGraphFn({ data: { id: entry.id } }));
    } catch (e) {
      setStatus(`Short link failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div>
      <div className="page-head">
        <p className="page-eyebrow">Gallery</p>
        <h1>Everything you've saved</h1>
        <p className="lede">
          "My saves" is private to this browser: every panel's "Save" button lands here, it survives app updates,
          and nothing is shared unless you publish it. The shared gallery below is one list visible to everyone
          who uses this app -- entries get there only via the explicit "Publish" button.
        </p>
        <p className="lede" style={{ fontSize: "0.9rem" }}>
          <strong>What's saved:</strong> a snapshot of that panel's state (expressions, viewport, etc.) at the
          moment you clicked "Save" -- a copy, not a live link back to the panel. <strong>Sharing it:</strong> "Copy
          short link" turns any save (local or published) into a compact <code>/s/:id</code> URL that redirects
          straight to it -- useful because a saved item's own encoded URL can get long. <strong>One honest caveat about
          the shared side:</strong> published entries and short links live on the server without durable storage,
          so both are cleared whenever the app is redeployed. Your private "My saves" (and any full graph URL you
          keep) are unaffected by redeploys -- copying the reopened graph's own URL remains the most durable way
          to keep or share something.
        </p>
      </div>

      <h2>My saves</h2>
      <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0 0.5rem" }}>
        Private to this browser. Publishing copies an entry to the shared gallery; your private copy stays.
      </p>
      {localSaves === null && <p>Loading…</p>}
      {localSaves?.length === 0 && <p>Nothing saved on this device yet -- use a panel's "Save" button.</p>}
      {localSaves && localSaves.length > 0 && (
        <ul>
          {localSaves.map((record) => (
            <li key={record.id} style={{ margin: "0.25rem 0" }}>
              <button type="button" onClick={() => openState(record.kind, record.state)} style={{ font: "inherit" }}>
                {record.title}
              </button>{" "}
              <span style={KIND_CHIP_STYLE}>{record.kind}</span>{" "}
              <span style={{ color: "#5b6b8c", fontSize: "0.85rem" }}>{new Date(record.createdAt).toLocaleString()}</span>{" "}
              <button type="button" onClick={() => publish(record)} title="Copy this save into the shared gallery everyone can see">
                Publish to shared gallery
              </button>{" "}
              <button type="button" onClick={() => copyShortLinkFor(record.kind, record.state)} title="Copy a short /s/:id link that redirects here">
                Copy short link
              </button>{" "}
              <button type="button" onClick={() => removeLocal(record.id)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <h2 style={{ marginTop: "1.5rem" }}>Shared gallery</h2>
      <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0 0.5rem" }}>
        One list shared by everyone who uses this app. Entries marked "Curated" are built-in examples; the rest are
        published saves, and are cleared whenever the app is redeployed.
      </p>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {entries === null && !error && <p>Loading…</p>}
      {entries?.length === 0 && <p>Nothing published yet.</p>}
      {entries && entries.length > 0 && (
        <ul>
          {entries.map((entry) => (
            <li key={entry.id} style={{ margin: "0.25rem 0" }}>
              <button type="button" onClick={() => openShared(entry)} style={{ font: "inherit" }}>
                {entry.title}
              </button>{" "}
              <span style={KIND_CHIP_STYLE}>{entry.kind}</span>{" "}
              <span style={{ color: "#5b6b8c", fontSize: "0.85rem" }}>{new Date(entry.createdAt).toLocaleString()}</span>{" "}
              <button type="button" onClick={() => copyShortLinkShared(entry)} title="Copy a short /s/:id link that redirects here">
                Copy short link
              </button>{" "}
              {entry.readOnly ? (
                <span style={{ fontSize: "0.75rem", color: "var(--muted)" }} title="A curated gallery seed -- can't be deleted">
                  Curated
                </span>
              ) : (
                <button type="button" onClick={() => removeShared(entry.id)}>
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {status && <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>{status}</p>}
    </div>
  );
}
