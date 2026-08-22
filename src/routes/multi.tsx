import { createFileRoute, Link } from "@tanstack/react-router";
import { GraphCanvasMulti } from "../components/GraphCanvasMulti.tsx";
import { LegacyBanner } from "../components/LegacyBanner.tsx";

interface MultiSearch {
  embed?: boolean;
}

export const Route = createFileRoute("/multi")({
  validateSearch: (search: Record<string, unknown>): MultiSearch => ({
    embed: search.embed === "1" || search.embed === true,
  }),
  component: MultiPage,
});

/**
 * `?embed=1` hides the page chrome (title, description, back-link) so this
 * route can be dropped into an `<iframe>` elsewhere and read as just the
 * interactive view -- the simplest form of the "embeddable widget" item
 * from the research roadmap, resolved via TanStack Router's typed search
 * params (validated identically during SSR and client nav, so there's no
 * hydration mismatch from branching on `window.location` directly).
 */
function MultiPage() {
  const { embed } = Route.useSearch();

  if (embed) {
    return (
      <div>
        <GraphCanvasMulti />
      </div>
    );
  }

  return (
    <div>
      <h1>mallory — multiple expressions, one graph</h1>
      <details>
        <summary>Several curves sharing one coordinate system and one canvas, with color, annotations, and sharing.</summary>
        <p>
          Unlike the linked-panes view, which shares a <code>CellGraph</code> but still renders each pane on its own
          separate canvas. v1 supports plotting, free-variable sliders, and an f' overlay (dashed, same color) per
          row; point-dragging, exact mode, the step-by-step differentiation trace, area/region shading, and
          finite-structure scatter stay single-expression-only for now (see <code>GraphCanvas</code>). Root crossings
          (where a curve meets y=0) are marked automatically, via a
          declarative "condition" cell decoupled from the drawing decision — the Open MCT-inspired pattern the
          roadmap flagged for flagging points of interest generally, since generalized (same underlying
          <code>findConditionCrossings</code>) to an arbitrary threshold, not just y=0. Discontinuities (a
          singularity or domain boundary in a curve) are marked the same way too, as open circles. Pairwise
          intersections between every currently visible pair of curves are marked the same way, in purple. The full
          state (every row, its
          color/visibility/sliders, annotations, and the viewport) lives in the URL, so reload restores the session,
          and "Fork this view" is just opening that same URL in a new tab to explore an alternate path independently.
          "+ Annotate" then click the canvas drops a labeled note at that point — click a marker or its label to
          select it, drag a selected marker to move it, edit its label in the list, or "Jump" to recenter the
          viewport on it (drag the canvas to pan, scroll to zoom, at any time) — an Open-MCT-inspired point
          annotation with cross-pane-style navigation, here within one shared view. Append <code>?embed=1</code> to this URL (or use it directly as
          an <code>&lt;iframe&gt;</code> <code>src</code>) for a chrome-free embeddable view. Each row's "strict"
          toggle uses <code>mallory-math</code>'s <code>Symbolic.assertVariables</code>: once on, anything besides{" "}
          <code>x</code> is a hard error instead of silently becoming a new slider — useful for catching a typo
          before it turns into a spurious parameter.
        </p>
      </details>
      <p>
        <Link to="/demos">← back</Link>
      </p>
      <LegacyBanner to="/graphing" label="Graphing" />
      <GraphCanvasMulti />
    </div>
  );
}
