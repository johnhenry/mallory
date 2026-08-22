import { createFileRoute, Link } from "@tanstack/react-router";
import { GraphCanvas } from "../components/GraphCanvas.tsx";
import { DEFAULT_GRAPH_STATE } from "../lib/graph-state.ts";

export const Route = createFileRoute("/demos")({
  component: DemosPage,
});

/**
 * The relocated legacy home page (this app's `/` before the SPA-shell pass)
 * -- kept verbatim, including its own single-expression `GraphCanvas`, as
 * an escape hatch out of the new shell rather than deleted. Deliberately a
 * plain top-level route (outside `_app`'s pathless layout), so it doesn't
 * carry the persistent sidebar -- it's meant to feel like the old app, not
 * the new one.
 */
function DemosPage() {
  return (
    <div>
      <h1>mallory — legacy demos</h1>
      <p>
        <Link to="/">← the new app</Link>
      </p>
      <p>
        <code>y = {DEFAULT_GRAPH_STATE.cells[0].source}</code>, sampled and plotted through mallory-math's reactive
        core (<code>Symbolic.compile</code> → <code>CellGraph</code> → <code>GraphUtils.vectorToCurve</code>).
      </p>
      <p>
        <Link to="/multi">Multiple expressions, one graph →</Link>
      </p>
      <p>
        <Link to="/linked">Linked multi-pane view →</Link>
      </p>
      <p>
        <Link to="/surface-3d">3D surface view →</Link>
      </p>
      <p>
        <Link to="/systems">System of equations solver →</Link>
      </p>
      <p>
        <Link to="/statistics">Statistics &amp; probability →</Link>
      </p>
      <p>
        <Link to="/ode">Differential equations →</Link>
      </p>
      <p>
        <Link to="/ode-system">System of differential equations →</Link>
      </p>
      <p>
        <Link to="/implicit">Implicit relations →</Link>
      </p>
      <p>
        <Link to="/parametric">Parametric &amp; polar curves →</Link>
      </p>
      <p>
        <Link to="/regression">Regression →</Link>
      </p>
      <p>
        <Link to="/geometry">Geometry construction →</Link>
      </p>
      <p>
        <Link to="/gallery">Gallery of saved graphs →</Link>
      </p>
      <p>
        <Link to="/notebook">Notebook →</Link>
      </p>
      <GraphCanvas />
    </div>
  );
}
