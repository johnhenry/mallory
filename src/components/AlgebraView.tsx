import { useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { structuralEqual, type CellGraph } from "../lib/cell-graph.ts";

function formatValue(value: unknown): string {
  if (typeof value === "number") return Number.isFinite(value) ? value.toFixed(4).replace(/\.?0+$/, "") : String(value);
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * GeoGebra-style "Algebra view": lists every non-auxiliary cell in `graph`
 * (see CellGraph.list/role/isAuxiliary), tagging each as a free object
 * (directly settable, e.g. a slider or the typed expression itself) or a
 * dependent one (computed from other cells). Internal sampling/UI-state
 * cells (path, derivative trace, drag-handle position, etc.) are marked
 * `auxiliary` by their owning component and hidden here by default, so this
 * reads as a short, meaningful object list rather than sampling-resolution
 * noise.
 *
 * Subscribes to the whole graph (`subscribeAll`) rather than one cell,
 * since the *set* of cells can change (a new free variable's slider cell
 * appears) as much as any individual value does.
 */
export function AlgebraView({ graph, showAuxiliary = false }: { graph: CellGraph; showAuxiliary?: boolean }) {
  // `graph.list()` allocates a brand-new array + objects on every call, with
  // no caching of its own -- passed directly as getSnapshot, that's exactly
  // the anti-pattern useSyncExternalStore warns against: React calls
  // getSnapshot repeatedly (including just to check "did anything actually
  // change"), and a snapshot that's never reference-equal to itself makes it
  // look like the store changes on every single check, which can spiral into
  // React's "Maximum update depth exceeded" (error #185). Caching the last
  // snapshot and only replacing it when the *contents* actually differ
  // (structuralEqual, the same check CellGraph itself uses to decide whether
  // a recompute changed anything) gives getSnapshot a stable reference to
  // return between real changes.
  const lastSnapshot = useRef<ReturnType<CellGraph["list"]>>([]);
  const getSnapshot = useCallback(() => {
    const next = graph.list();
    if (!structuralEqual(next, lastSnapshot.current)) lastSnapshot.current = next;
    return lastSnapshot.current;
  }, [graph]);

  const entries = useSyncExternalStore(
    useCallback((onChange) => graph.subscribeAll(onChange), [graph]),
    getSnapshot,
    getSnapshot,
  );

  // `entries` above only changes reference when the cell *list's shape*
  // does (a cell added/removed, role/auxiliary/hasValue flipping) -- by
  // design, so a value-only change to an already-listed cell (e.g.
  // dragging a free point, or any slider) doesn't itself trigger a
  // re-render. But `formatValue(graph.get(e.id))` below always reads the
  // *current* value directly, not from `entries` -- so the fix isn't to
  // make the list-snapshot value-sensitive (that would reintroduce the
  // new-array-every-call problem the comment above this hook works around,
  // and would be genuinely expensive for a cell like a sampled mesh), just
  // to prompt a re-render on every graph mutation, structural or not, so
  // that inline read actually happens again.
  const [, forceRerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => graph.subscribeAll(forceRerender), [graph]);

  const visible = entries
    .filter((e) => e.hasValue && e.role !== "unknown" && (showAuxiliary || !e.auxiliary))
    .sort((a, b) => a.id.localeCompare(b.id));

  // Which entries are shown expanded rather than truncated to one ellipsized
  // line -- a cell like a sampled mesh (`mesh3d:...`) formats to a
  // multi-thousand-character JSON blob that would otherwise blow out the
  // page width/height by default.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (visible.length === 0) return null;

  return (
    <div style={{ fontSize: "0.9rem", border: "1px solid var(--border)", borderRadius: 4, padding: "0.5rem 0.75rem" }}>
      <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>Objects</div>
      <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
        {visible.map((e) => {
          const isExpanded = expanded.has(e.id);
          return (
            <li key={e.id} style={{ fontFamily: "monospace", maxWidth: "100%" }}>
              <span style={{ color: e.role === "free" ? "#2563eb" : "#5b6b8c" }}>{e.role === "free" ? "○" : "●"}</span>{" "}
              <button
                type="button"
                onClick={() => toggle(e.id)}
                title={isExpanded ? "Click to collapse" : "Click to expand"}
                style={{
                  font: "inherit",
                  fontFamily: "inherit",
                  color: "inherit",
                  background: "none",
                  border: "none",
                  padding: 0,
                  margin: 0,
                  cursor: "pointer",
                  textAlign: "left",
                  display: "inline-block",
                  maxWidth: "calc(100% - 1.5rem)",
                  verticalAlign: "top",
                  whiteSpace: isExpanded ? "pre-wrap" : "nowrap",
                  overflow: isExpanded ? "auto" : "hidden",
                  textOverflow: isExpanded ? "clip" : "ellipsis",
                  overflowWrap: isExpanded ? "break-word" : "normal",
                  maxHeight: isExpanded ? "12rem" : undefined,
                }}
              >
                {e.id} = {formatValue(graph.get(e.id))}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
