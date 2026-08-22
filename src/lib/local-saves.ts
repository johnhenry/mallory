/**
 * Local-first "My saves" store (#320 step 3) -- the panels' "Save" buttons
 * now write HERE (this browser's localStorage) instead of straight to the
 * server's shared gallery. Two reasons, both from the #320 audit:
 *
 * 1. **Privacy by default.** The server gallery is one list shared by
 *    everyone -- "Save to gallery" was really "publish to everyone", which
 *    nothing in the UI said. Now saving is private, and publishing to the
 *    shared gallery is a separate, explicit action on the gallery page.
 * 2. **Durability, ironically.** The server DB lives on an unmounted
 *    `data/` dir and is wiped on every deploy; localStorage survives
 *    deploys. Until/unless a storage mount lands, the user's own browser
 *    is genuinely the MORE durable store.
 *
 * Same record shape as the server store (`title`/`kind`/`state`/
 * `createdAt` + a `crypto.randomUUID()` id) so "Publish to shared gallery"
 * is a straight pass-through to `saveGraph` with no translation.
 *
 * The parse/serialize core is pure (localStorage-free) so it's testable
 * under plain Node; the exported CRUD wrappers no-op-read as `[]` when
 * `localStorage` is unavailable (SSR pass) and never throw on quota or
 * corrupted-JSON problems -- a broken store reads as empty rather than
 * taking the gallery page down.
 */
import type { SavedGraphKind, SavedGraphState } from "./saved-graphs.ts";

export interface LocalSaveRecord {
  id: string;
  title: string;
  kind: SavedGraphKind;
  createdAt: number;
  state: SavedGraphState;
}

const STORAGE_KEY = "mallory:my-saves";

/** Pure core: parse a raw localStorage value into records, dropping anything malformed (a corrupted entry loses itself, not the whole store). Newest first, matching the server gallery's ordering. */
export function parseLocalSaves(raw: string | null): LocalSaveRecord[] {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((r): r is LocalSaveRecord => {
        if (typeof r !== "object" || r === null) return false;
        const c = r as Record<string, unknown>;
        return typeof c.id === "string" && typeof c.title === "string" && typeof c.kind === "string" && typeof c.createdAt === "number" && c.state !== undefined;
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

function hasLocalStorage(): boolean {
  return typeof localStorage !== "undefined";
}

export function listLocalSaves(): LocalSaveRecord[] {
  if (!hasLocalStorage()) return [];
  try {
    return parseLocalSaves(localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

/** Saves and returns the new record. Throws only if localStorage itself rejects the write (quota) -- callers surface that in their save-status line. */
export function addLocalSave(data: { title: string; kind: SavedGraphKind; state: SavedGraphState }): LocalSaveRecord {
  const record: LocalSaveRecord = {
    id: crypto.randomUUID(),
    title: data.title.trim() || "Untitled",
    kind: data.kind,
    createdAt: Date.now(),
    state: data.state,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify([record, ...listLocalSaves()]));
  return record;
}

export function getLocalSave(id: string): LocalSaveRecord | undefined {
  return listLocalSaves().find((r) => r.id === id);
}

export function deleteLocalSave(id: string): void {
  if (!hasLocalStorage()) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(listLocalSaves().filter((r) => r.id !== id)));
}
