import { createFileRoute } from "@tanstack/react-router";
import { CategoryTabs } from "~/components/CategoryTabs.tsx";
import { ComplexPanel } from "~/components/ComplexPanel.tsx";
import { GraphCanvasMulti } from "~/components/GraphCanvasMulti.tsx";
import { ImplicitPanel } from "~/components/ImplicitPanel.tsx";
import { LinkedGraphPanes } from "~/components/LinkedGraphPanes.tsx";
import { ParametricPanel } from "~/components/ParametricPanel.tsx";

interface GraphingSearch {
  tab?: string;
}

export const Route = createFileRoute("/_app/graphing")({
  validateSearch: (search: Record<string, unknown>): GraphingSearch => ({
    tab: typeof search.tab === "string" ? search.tab : undefined,
  }),
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
        syncSearchParam="tab"
        tabs={[
          { label: "Expression", key: "multi", render: () => <GraphCanvasMulti /> },
          { label: "Implicit", key: "implicit", render: () => <ImplicitPanel /> },
          { label: "Parametric & Polar", key: "parametric", render: () => <ParametricPanel /> },
          { label: "Complex plane", key: "complex", render: () => <ComplexPanel /> },
          { label: "Compare", key: "compare", render: () => <LinkedGraphPanes /> },
        ]}
      />
    </div>
  );
}
