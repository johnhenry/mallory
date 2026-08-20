import { useEffect, useRef, useState } from "react";
import { addLocalSave } from "../lib/local-saves.ts";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIds, cellIds3D } from "../lib/cell-ids.ts";
import { Graph3DCanvas } from "./Graph3DCanvas.tsx";
import { GraphCanvas } from "./GraphCanvas.tsx";
import { decodeLinked3DState, encodeLinked3DState, type Linked3DState } from "../lib/linked3d-state.ts";

const CROSS_SECTION_RANGE = { min: -5, max: 5, step: 0.1 };

/** Builds the full serializable state of the linked 2D+3D view -- shared by the URL-sync effect and the save-to-gallery handler. */
function getCurrentLinked3DState(graph: CellGraph, crossSectionY: number): Linked3DState {
  const ids2D = cellIds("pane-2d");
  const ids3D = cellIds3D("pane-3d");
  const names2D = graph.hasValue(ids2D.freeVars) ? graph.get<string[]>(ids2D.freeVars) : [];
  const params2D: Record<string, number> = {};
  for (const name of names2D) params2D[name] = graph.get<number>(ids2D.param(name));
  const names3D = graph.hasValue(ids3D.freeVars) ? graph.get<string[]>(ids3D.freeVars) : [];
  const params3D: Record<string, number> = {};
  for (const name of names3D) params3D[name] = graph.get<number>(ids3D.param(name));
  return {
    v: 1,
    pane2d: {
      source: graph.get<string>(ids2D.expr),
      params: params2D,
      structureModulus: graph.hasValue(ids2D.structure) ? graph.get<number | null>(ids2D.structure) : null,
    },
    pane3d: { source: graph.get<string>(ids3D.expr), params: params3D },
    crossSectionY,
  };
}

// Deliberately not namespaced by cellId, same reasoning as LinkedGraphPanes's
// own combinedDuration cell: one shared graph per linked view, and the 2D
// pane's transport (the only transport in this view) should scrub across the
// longer of the two panes' animations, not cut off at the 2D pane's own.
//
// The compute below is defined here, before either child pane has rendered
// (and thus before either pane's own `timelineDuration` cell exists) -- its
// very first read sees `undefined` for whichever pane hasn't mounted yet
// (the 3D pane renders after the 2D one in this tree), so a bare
// `Math.max(0, undefined)` would momentarily be `NaN` until the 3D pane
// mounts and the corrected `0` propagates through. That transient NaN-then-0
// flip is exactly what tripped React's "getServerSnapshot should be cached"
// hydration warning (mallory-graph#10) -- `Number.isFinite` below guards
// against it so the very first read already settles on the value the later,
// fully-mounted recompute would produce.
const COMBINED_DURATION_CELL = "combined3DDuration";

/**
 * A 2D pane and a 3D surface pane sharing one CellGraph -- the same
 * reactive core (CellGraph + cell-id namespacing) that drives every 2D pane
 * in this app also drives the 3D one; only the sampling (sample-function.ts
 * vs sample-surface.ts) and rendering (Canvas2D vs Three.js) differ per
 * dimensionality. Sharing a graph here (rather than each pane owning a
 * private one) is what let the cross-pane link below (the 3D surface's
 * y=crossSectionY cross-section, highlighted in red) reuse the exact
 * default expressions -- sin(x) and sin(x)*cos(y) -- where the highlighted
 * slice at y=0 exactly traces the 2D pane's own curve, cos(0) being 1.
 * `crossSectionY` is plain component state (not a graph cell) since nothing
 * else needs to derive from it; it's passed straight to `Graph3DCanvas`,
 * which resamples the highlight itself whenever it or the 3D expression
 * changes -- also captured in linked3d-state.ts's URL/Gallery persistence,
 * so a reopened link/save restores the same cross-section highlight.
 *
 * Both panes turn off their own `syncUrl` (GraphCanvas's single-pane
 * persistence would otherwise clobber the hash with just its own state;
 * Graph3DCanvas has no persistence of its own to turn off) -- this
 * component does one combined hydrate/write instead, mirroring
 * LinkedGraphPanes's identical two-pane pattern: hydration runs in a
 * `useEffect` (after both panes' own lazy graph construction has already
 * run with their hardcoded defaultSource), writing params/structure before
 * source so each pane's lazy default-slider-seeding finds them already
 * populated.
 */
export function Linked3DView() {
  const graphRef = useRef<CellGraph | null>(null);
  if (!graphRef.current) {
    const graph = new CellGraph();
    const ids2D = cellIds("pane-2d");
    const ids3D = cellIds3D("pane-3d");
    graph.define(COMBINED_DURATION_CELL, () => {
      const a = graph.get<number>(ids2D.timelineDuration);
      const b = graph.get<number>(ids3D.timelineDuration);
      return Math.max(Number.isFinite(a) ? a : 0, Number.isFinite(b) ? b : 0);
    });
    graphRef.current = graph;
  }
  const graph = graphRef.current;
  const [crossSectionY, setCrossSectionY] = useState(0);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  useEffect(() => {
    const decoded = decodeLinked3DState(window.location.hash.slice(1));
    if (!decoded) return;
    const ids2D = cellIds("pane-2d");
    const ids3D = cellIds3D("pane-3d");
    for (const [name, value] of Object.entries(decoded.pane2d.params)) graph.set(ids2D.param(name), value);
    graph.set(ids2D.structure, decoded.pane2d.structureModulus);
    for (const [name, value] of Object.entries(decoded.pane3d.params)) graph.set(ids3D.param(name), value);
    graph.set(ids2D.expr, decoded.pane2d.source);
    graph.set(ids3D.expr, decoded.pane3d.source);
    setCrossSectionY(decoded.crossSectionY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeLinked3DState(getCurrentLinked3DState(graph, crossSectionY))}`);
    }
    writeUrl();
    return graph.subscribeAll(writeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, crossSectionY]);

  async function handleSave() {
    const title = window.prompt("Title for this saved 3D view:", "Untitled");
    if (title === null) return;
        try {
      addLocalSave({ title, kind: "surface-3d", state: getCurrentLinked3DState(graph, crossSectionY) });
      setSaveStatus(`Saved as "${title || "Untitled"}" to My saves on this device — reopen or publish it from the gallery.`);
    } catch (e) {
      setSaveStatus(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
        {/* `minWidth: 0` overrides flexbox's default min-width:auto, which
            would otherwise floor each pane at its (fixed-pixel canvas)
            content size and defeat the canvas's own responsive shrinking. */}
        <div style={{ minWidth: 0 }}>
          {/* initialViewport: same #306 fix as the Compare tab (issue #308) --
              the global default viewport (y -10..100, sized for x^2)
              squashes this pane's amplitude-1 sin(x) default flat. */}
          <GraphCanvas
            cellId="pane-2d"
            defaultSource="sin(x)"
            durationCellId={COMBINED_DURATION_CELL}
            graph={graph}
            initialViewport={{ xMin: -10, xMax: 10, yMin: -2, yMax: 2 }}
            syncUrl={false}
          />
        </div>
        <div style={{ minWidth: 0 }}>
          <Graph3DCanvas
            cellId="pane-3d"
            defaultSource="sin(x)*cos(y)"
            graph={graph}
            crossSectionY={crossSectionY}
            showTransport={false}
          />
        </div>
      </div>
      <label style={{ display: "block", margin: "0.5rem 0", fontSize: "0.9rem" }}>
        Cross-section y = {crossSectionY.toFixed(2)} (highlighted in red on the 3D surface)
        <input
          type="range"
          min={CROSS_SECTION_RANGE.min}
          max={CROSS_SECTION_RANGE.max}
          step={CROSS_SECTION_RANGE.step}
          value={crossSectionY}
          onChange={(e) => setCrossSectionY(Number(e.target.value))}
          style={{ display: "block", width: "100%", maxWidth: "20rem" }}
        />
      </label>
      <div style={{ margin: "0.5rem 0" }}>
        <button type="button" onClick={handleSave}>
          Save
        </button>
        {saveStatus && <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>{saveStatus}</p>}
      </div>
    </div>
  );
}
