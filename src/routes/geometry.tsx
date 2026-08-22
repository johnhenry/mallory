import { createFileRoute, Link } from "@tanstack/react-router";
import { GeometryPanel } from "../components/GeometryPanel.tsx";
import { LegacyBanner } from "../components/LegacyBanner.tsx";

export const Route = createFileRoute("/geometry")({
  component: GeometryPage,
});

function GeometryPage() {
  return (
    <div>
      <h1>mallory — geometry construction</h1>
      <details>
        <summary>Compass-and-straightedge construction tools, built on CellGraph's free/dependent object model.</summary>
        <p>
          Click with the Point tool to place a free point (or drag an existing one), then Line/Circle to connect
          existing points. Each Line/Circle also gets a genuinely <em>dependent</em> length/radius cell reading its
          points' live coordinates — the Objects list below shows both kinds side by side. Reflect/Rotate/Translate
          each construct a new point that is itself dependent on the point(s) it was built from, so dragging a free
          point cascades through every line, circle, and transform built from it. Free points are drawn in blue,
          dependent (constructed) points in gray-blue — only free points are draggable, since a dependent point's
          position is entirely determined by what it was built from. A Line/Circle whose defining points have
          collapsed onto each other (zero length/radius) draws in amber instead — the same declarative
          condition-flag pattern <code>/multi</code> uses for root crossings and discontinuities, applied here to
          "this construction has degenerated." Scale dilates a point about a center by a fixed factor; Angle measures
          the interior angle between two rays (click a point, the vertex, then the other point); Polygon connects an
          ordered run of vertices, closed by re-clicking the first one, with its area shown in the Objects list.
        </p>
      </details>
      <p>
        <Link to="/demos">← back</Link>
      </p>
      <LegacyBanner to="/geo" label="Geometry" />
      <GeometryPanel />
    </div>
  );
}
