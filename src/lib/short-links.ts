/**
 * Server-side short links (issue #44 item 2): a URL-hash-encoded state
 * string can get very long (a 10-block notebook, say), unwieldy to share.
 * `createShortLink` stores the ALREADY-encoded hash fragment (whatever a
 * panel's own `encodeXState` produced, e.g. gallery.tsx's `REOPEN_HREF`
 * builders already compute one) plus which panel it belongs to, and hands
 * back a short id; visiting `/s/:id` (see routes/s.$id.tsx) looks it back
 * up and redirects to the real panel URL with the hash restored.
 *
 * Deliberately does NOT decode/re-encode the state itself (unlike
 * saved-graphs.ts's gallery store, which needs the typed state to satisfy
 * `SavedGraphState`'s union) -- a short link only ever needs to reproduce
 * the exact URL fragment a client already built, so storing it verbatim
 * as an opaque string is both simpler and avoids a second copy of every
 * state codec's encode/decode logic here.
 *
 * Shares saved-graphs.ts's own SQLite connection (`getGalleryDb`) rather
 * than opening a second file, per the issue's own "same SQLite db"
 * suggestion -- a short link and a gallery save are two different tables
 * in one file, not two separate stores.
 */
import type { DatabaseSync } from "node:sqlite";
import { createServerFn } from "@tanstack/react-start";
import { getGalleryDb, type SavedGraphKind } from "./saved-graphs.ts";

/**
 * Where `/s/:id` redirects to for each kind -- deliberately a second,
 * independent copy of gallery.tsx's own per-kind `REOPEN_HREF` path
 * prefixes (not shared), since that side needs the full typed-state ->
 * encode round trip and this side only ever needs the bare path a hash
 * gets appended to.
 */
const REDIRECT_PATH: Record<SavedGraphKind, string> = {
  multi: "/graphing",
  notebook: "/notes",
  geometry: "/geo",
  "surface-3d": "/3d",
  ode: "/calculus?tab=ode",
  "ode-system": "/calculus?tab=ode-system",
  regression: "/data?tab=regression",
  statistics: "/data?tab=statistics",
  systems: "/data?tab=systems",
  complex: "/graphing?tab=complex",
};

/** Idempotent -- safe to call on every access, mirroring `ensureSavedGraphsSchema`'s own convention. */
export function ensureShortLinksSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS short_links (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      encoded_state TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
}

const SHORT_ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const SHORT_ID_LENGTH = 8;

/**
 * An 8-char base62 id -- 62^8 (~218 trillion) possibilities, effectively
 * collision-free at this app's realistic save volume. `random` is
 * injectable so the distribution is testable without depending on
 * `Math.random`'s actual output.
 */
export function generateShortId(random: () => number = Math.random): string {
  let id = "";
  for (let i = 0; i < SHORT_ID_LENGTH; i++) {
    id += SHORT_ID_ALPHABET[Math.floor(random() * SHORT_ID_ALPHABET.length)];
  }
  return id;
}

export function insertShortLink(
  db: DatabaseSync,
  record: { id: string; kind: SavedGraphKind; encodedState: string; createdAt: number },
): void {
  db.prepare("INSERT INTO short_links (id, kind, encoded_state, created_at) VALUES (?, ?, ?, ?)").run(
    record.id,
    record.kind,
    record.encodedState,
    record.createdAt,
  );
}

/** The full redirect target (path + `?search` + `#hash`) for a short-link id, or undefined if it doesn't exist. */
export function resolveShortLinkTarget(db: DatabaseSync, id: string): string | undefined {
  const row = db.prepare("SELECT kind, encoded_state FROM short_links WHERE id = ?").get(id) as
    | { kind: SavedGraphKind; encoded_state: string }
    | undefined;
  if (row === undefined) return undefined;
  return `${REDIRECT_PATH[row.kind]}#${row.encoded_state}`;
}

export const createShortLink = createServerFn({ method: "POST" })
  .validator((data: { kind: SavedGraphKind; encodedState: string }) => data)
  .handler(async ({ data }): Promise<{ id: string }> => {
    const db = await getGalleryDb();
    ensureShortLinksSchema(db);
    let id = generateShortId();
    // Defensive collision retry -- astronomically unlikely at 62^8, but cheap to guard against rather than assume away.
    while (resolveShortLinkTarget(db, id) !== undefined) id = generateShortId();
    insertShortLink(db, { id, kind: data.kind, encodedState: data.encodedState, createdAt: Date.now() });
    return { id };
  });

export const resolveShortLink = createServerFn({ method: "GET" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<string | null> => {
    const db = await getGalleryDb();
    ensureShortLinksSchema(db);
    return resolveShortLinkTarget(db, data.id) ?? null;
  });
