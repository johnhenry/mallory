import { useEffect, useRef } from "react";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIds } from "../lib/cell-ids.ts";
import { DEFAULT_GRAPH_STATE, decodeGraphState, encodeGraphState, type GraphState } from "../lib/graph-state.ts";
import { useDebouncedSubscribeAll } from "../hooks/use-debounced-subscribe-all.ts";
import { GraphCanvas } from "./GraphCanvas.tsx";

const PANE_IDS = ["pane-a", "pane-b"] as const;
const PANE_DEFAULT_SOURCE: Record<(typeof PANE_IDS)[number], string> = {
  "pane-a": "sin(x)",
  "pane-b": "cos(x)",
};

// mallory-graph#305 bug 2: the global default viewport
// (DEFAULT_GRAPH_STATE.viewport, y in -10..100) fits the main tab's
// default x^2, but squashes this tab's amplitude-1 sin/cos into a flat
// line at the bottom of the pane. Both panes get a viewport matched to
// their own trig defaults instead; pan/zoom and URL-hydrated state still
// override it as usual.
const PANE_INITIAL_VIEWPORT = { xMin: -10, xMax: 10, yMin: -2, yMax: 2 };

// Deliberately not namespaced by cellId, same reasoning as TIME_CELL: there's
// one shared graph per linked view, and the primary pane's transport should
// scrub across the longer of the two panes' animations, not cut off at
// whichever pane happens to be "primary."
const COMBINED_DURATION_CELL = "combinedDuration";

/**
 * Two panes sharing one CellGraph. Each pane keeps its own
 * expression/params/timeline-duration cells (namespaced by cellId, via
 * GraphCanvas's `cellIds` factory), so they can plot independent
 * expressions -- but they share the graph's single TIME_CELL, so playing or
 * scrubbing the primary pane's transport animates both curves in lockstep.
 * Only the primary pane renders a transport; both panes turn off their own
 * `syncUrl` and this component does one combined hydrate/write instead, so
 * the URL fragment round-trips every pane's source/params/structureModulus
 * rather than just the first cell's (see graph-state.ts's v3 schema). The
 * primary pane's transport is pointed at `combinedDuration` (the max of both
 * panes' own `timelineDuration` cells) via GraphCanvas's `durationCellId`
 * prop, rather than defaulting to its own -- otherwise scrubbing/playing
 * would stop as soon as pane-a's animation ends even if pane-b's runs
 * longer. Safe to `define` here before either pane's own `timelineDuration`
 * cell exists yet: `CellGraph.get()` on an undefined id still registers the
 * dependency edge, and `useSyncExternalStore`'s subscribe-time consistency
 * check catches the resulting dirty flag and re-renders once both panes have
 * mounted and defined their own duration cells. That first read, though,
 * sees `undefined` for whichever pane hasn't mounted yet (only pane-a has,
 * at this point in pane-a's own render) -- `Math.max(0, undefined)` is
 * `NaN`, a real (if momentary) wrong value, not just a cosmetic quirk: it's
 * exactly what trips React's "getServerSnapshot should be cached" hydration
 * warning once the corrected `0` lands a moment later (mallory-graph#10).
 * `Number.isFinite` guards each side so the first read already settles on
 * the same `0` the later, fully-mounted recompute would produce.
 */
export function LinkedGraphPanes() {
  const graphRef = useRef<CellGraph | null>(null);
  if (!graphRef.current) {
    const graph = new CellGraph();
    const idsA = cellIds(PANE_IDS[0]);
    const idsB = cellIds(PANE_IDS[1]);
    graph.define(COMBINED_DURATION_CELL, () => {
      const a = graph.get<number>(idsA.timelineDuration);
      const b = graph.get<number>(idsB.timelineDuration);
      return Math.max(Number.isFinite(a) ? a : 0, Number.isFinite(b) ? b : 0);
    });
    graphRef.current = graph;
  }
  const graph = graphRef.current;

  useEffect(() => {
    const decoded = decodeGraphState(window.location.hash.slice(1));
    if (!decoded) return;
    // Params/structure are written before the source, same reasoning as
    // GraphCanvas's own single-pane hydration: it lets each pane's lazy
    // default-slider-seeding find these cells already populated.
    for (const cellState of decoded.cells) {
      const ids = cellIds(cellState.id);
      for (const [name, value] of Object.entries(cellState.params)) graph.set(ids.param(name), value);
      graph.set(ids.structure, cellState.structureModulus);
    }
    for (const cellState of decoded.cells) {
      const ids = cellIds(cellState.id);
      graph.set(ids.expr, cellState.source);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function writeUrl() {
    const cells = PANE_IDS.map((cellId) => {
      const ids = cellIds(cellId);
      const names = graph.get<string[]>(ids.freeVars);
      const params: Record<string, number> = {};
      for (const name of names) params[name] = graph.get<number>(ids.param(name));
      return {
        id: cellId,
        source: graph.get<string>(ids.expr),
        params,
        structureModulus: graph.get<number | null>(ids.structure),
      };
    });
    const state: GraphState = { v: 3, cells, viewport: DEFAULT_GRAPH_STATE.viewport, mode: "float" };
    window.history.replaceState(null, "", `#${encodeGraphState(state)}`);
  }
  useEffect(() => {
    writeUrl();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);
  // Debounced (issue #235), not a plain subscribeAll: writeUrl reads neither
  // TIME_CELL nor a pane's viewport (this component's own doc comment notes
  // it always writes DEFAULT_GRAPH_STATE.viewport), so a subscribeAll here
  // used to re-run writeUrl on every RAF tick of the shared transport's
  // playback -- both panes' curves animate off TIME_CELL, but the URL never
  // encodes playback position. Each pane's own free-variable set is dynamic
  // (depends on its current expression), so unlike the fixed-cell-list
  // panels this can't cleanly switch to `subscribeMany`.
  useDebouncedSubscribeAll(graph, writeUrl);

  return (
    <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
      {/* `minWidth: 0` overrides flexbox's default min-width:auto, which
          would otherwise floor each pane at its (fixed-pixel canvas)
          content size and defeat the canvas's own responsive shrinking. */}
      <div style={{ minWidth: 0 }}>
        <GraphCanvas
          cellId="pane-a"
          defaultSource={PANE_DEFAULT_SOURCE["pane-a"]}
          durationCellId={COMBINED_DURATION_CELL}
          graph={graph}
          initialViewport={PANE_INITIAL_VIEWPORT}
          syncUrl={false}
        />
      </div>
      <div style={{ minWidth: 0 }}>
        <GraphCanvas
          cellId="pane-b"
          defaultSource={PANE_DEFAULT_SOURCE["pane-b"]}
          graph={graph}
          initialViewport={PANE_INITIAL_VIEWPORT}
          showTransport={false}
          syncUrl={false}
        />
      </div>
    </div>
  );
}
