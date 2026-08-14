import { createFileRoute } from "@tanstack/react-router";
import { CategoryTabs } from "~/components/CategoryTabs.tsx";
import { ComplexPanel } from "~/components/ComplexPanel.tsx";
import { GraphCanvasMulti } from "~/components/GraphCanvasMulti.tsx";
import { ImplicitPanel } from "~/components/ImplicitPanel.tsx";
import { LinkedGraphPanes } from "~/components/LinkedGraphPanes.tsx";
import { ParametricPanel } from "~/components/ParametricPanel.tsx";

export const Route = createFileRoute("/_app/graphing")({
  component: GraphingPage,
});

function GraphingPage() {
  return (
    <div>
      <div className="page-head">
        <p className="page-eyebrow">Graphing</p>
        <h1>Plot, compare, and animate curves.</h1>
        <p className="lede">Four modes: shared-canvas curves, implicit relations, parametric/polar paths, or two linked panes.</p>
      </div>
      <CategoryTabs
        prefix="graphing"
        tabs={[
          { label: "Multi-expression", render: () => <GraphCanvasMulti /> },
          { label: "Implicit", render: () => <ImplicitPanel /> },
          { label: "Parametric & Polar", render: () => <ParametricPanel /> },
          { label: "Complex plane", render: () => <ComplexPanel /> },
          { label: "Compare", render: () => <LinkedGraphPanes /> },
        ]}
      />
    </div>
  );
}
