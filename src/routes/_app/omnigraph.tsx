import { createFileRoute } from "@tanstack/react-router";
import { OmnigraphPanel } from "~/components/OmnigraphPanel.tsx";

export const Route = createFileRoute("/_app/omnigraph")({
  component: OmnigraphPage,
});

function OmnigraphPage() {
  return (
    <div>
      <div className="page-head">
        <p className="page-eyebrow">Omnigraph</p>
        <h1>Every graph type, one surface.</h1>
        <p className="lede">
          Add items and pick each one's type from a dropdown -- curves, implicit relations, polar plots, and complex colorings share a
          single canvas instead of living in separate tabs.
        </p>
      </div>
      <OmnigraphPanel />
    </div>
  );
}
