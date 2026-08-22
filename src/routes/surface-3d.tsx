import { createFileRoute, Link } from "@tanstack/react-router";
import { LegacyBanner } from "../components/LegacyBanner.tsx";
import { Linked3DView } from "../components/Linked3DView.tsx";

export const Route = createFileRoute("/surface-3d")({
  component: ThreeDPage,
});

function ThreeDPage() {
  return (
    <div>
      <h1>mallory — 3D surface</h1>
      <details>
        <summary>A 2D curve and a 3D surface, sharing one reactive core.</summary>
        <p>
          Via <code>CellGraph</code>: sampling (<code>sample-function.ts</code> vs <code>sample-surface.ts</code>)
          and rendering (Canvas2D vs Three.js) differ, but the expression/params/free-var plumbing is the same. A
          "cross-section y" slider highlights the 3D surface's matching slice in red -- with the default
          expressions, that slice exactly traces the 2D pane's curve at y=0. "Export video" renders a shareable
          MP4/GIF of the surface with a full camera orbit, server-side via ecmanim.
        </p>
      </details>
      <p>
        <Link to="/demos">← back</Link>
      </p>
      <LegacyBanner to="/3d" label="3D & Surfaces" />
      <Linked3DView />
    </div>
  );
}
