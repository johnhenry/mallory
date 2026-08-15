/**
 * Server-only save/gallery store for GraphCanvasMulti AND NotebookPanel
 * sessions -- a minimal "publish" primitive from the research roadmap (not
 * real-time collaboration or a full community platform, just
 * save-and-list-and-reopen). A plain JSON file under `data/`, mirroring
 * export-video.ts's "single Dokku process, no real queue/DB infra needed
 * yet" reasoning -- good enough for one app instance, not a
 * multi-instance-safe store.
 *
 * One shared store for both kinds (rather than a second parallel gallery):
 * a `kind` discriminant on each record says which state shape/encoder it
 * needs. Records saved before `kind` existed have no such field -- treated
 * as `"multi"` (the only kind that existed then) throughout, so old saved
 * graphs keep working unchanged.
 */
import { createServerFn } from "@tanstack/react-start";
import type { ComplexState } from "./complex-state.ts";
import type { GeometryState } from "./geometry-state.ts";
import type { Linked3DState } from "./linked3d-state.ts";
import type { MultiGraphState } from "./multi-graph-state.ts";
import type { NotebookState } from "./notebook-state.ts";
import type { OdeState } from "./ode-state.ts";
import type { OdeSystemState } from "./ode-system-state.ts";
import type { RegressionState } from "./regression-state.ts";
import type { StatisticsState } from "./statistics-state.ts";
import type { SystemState } from "./system-state.ts";

export type SavedGraphKind =
  | "multi"
  | "notebook"
  | "geometry"
  | "surface-3d"
  | "ode"
  | "ode-system"
  | "regression"
  | "statistics"
  | "systems"
  | "complex";

export type SavedGraphState =
  | MultiGraphState
  | NotebookState
  | GeometryState
  | Linked3DState
  | OdeState
  | OdeSystemState
  | RegressionState
  | StatisticsState
  | SystemState
  | ComplexState;

export interface SavedGraphSummary {
  id: string;
  title: string;
  createdAt: number;
  kind: SavedGraphKind;
}

interface SavedGraphRecord extends SavedGraphSummary {
  state: SavedGraphState;
}

async function dataFilePath(): Promise<string> {
  const path = await import("node:path");
  return path.join(process.cwd(), "data", "saved-graphs.json");
}

/**
 * Backward compatibility: a record saved before `kind` existed is implicitly
 * "multi", the only kind that existed then -- the on-disk shape may
 * genuinely lack `kind`, unlike `SavedGraphRecord`'s static type. Extracted
 * as a pure function so this migration logic is unit-testable without
 * touching the filesystem or `createServerFn`'s server-only wrapper.
 */
export function migrateSavedGraphRecord(
  r: Omit<SavedGraphRecord, "kind"> & { kind?: SavedGraphKind },
): SavedGraphRecord {
  return { ...r, kind: r.kind ?? "multi" };
}

async function readStore(): Promise<SavedGraphRecord[]> {
  const { promises: fs } = await import("node:fs");
  try {
    const raw = await fs.readFile(await dataFilePath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as Array<Omit<SavedGraphRecord, "kind"> & { kind?: SavedGraphKind }>).map(migrateSavedGraphRecord);
  } catch {
    return [];
  }
}

async function writeStore(records: SavedGraphRecord[]): Promise<void> {
  const { promises: fs } = await import("node:fs");
  const path = await import("node:path");
  const filePath = await dataFilePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(records, null, 2));
}

export const saveGraph = createServerFn({ method: "POST" })
  .validator((data: { title: string; kind: SavedGraphKind; state: SavedGraphState }) => data)
  .handler(async ({ data }): Promise<{ id: string }> => {
    const records = await readStore();
    const id = crypto.randomUUID();
    records.push({ id, title: data.title.trim() || "Untitled", createdAt: Date.now(), kind: data.kind, state: data.state });
    await writeStore(records);
    return { id };
  });

export const listSavedGraphs = createServerFn({ method: "GET" }).handler(async (): Promise<SavedGraphSummary[]> => {
  const records = await readStore();
  return records
    .map(({ id, title, createdAt, kind }) => ({ id, title, createdAt, kind }))
    .sort((a, b) => b.createdAt - a.createdAt);
});

export const getSavedGraph = createServerFn({ method: "GET" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<SavedGraphState> => {
    const records = await readStore();
    const record = records.find((r) => r.id === data.id);
    if (!record) throw new Error("Unknown or deleted saved graph.");
    return record.state;
  });

export const deleteSavedGraph = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<void> => {
    const records = await readStore();
    await writeStore(records.filter((r) => r.id !== data.id));
  });
