import { createFileRoute } from "@tanstack/react-router";
import { CategoryTabs } from "~/components/CategoryTabs.tsx";
import { Linked3DView } from "~/components/Linked3DView.tsx";
import { ParametricSurfacePanel } from "~/components/ParametricSurfacePanel.tsx";

interface ThreeDSearch {
  tab?: string;
}

export const Route = createFileRoute("/_app/3d")({
  validateSearch: (search: Record<string, unknown>): ThreeDSearch => ({
    tab: typeof search.tab === "string" ? search.tab : undefined,
  }),
  component: ThreeDPage,
});

function ThreeDPage() {
  return (
    <div>
      <div className="page-head">
        <p className="page-eyebrow">3D &amp; Surfaces</p>
        <h1>z = f(x, y), or a parametric surface.</h1>
        <p className="lede">A 2D curve and a 3D surface, sharing one reactive core -- or a torus/sphere/Möbius strip via r(u,v).</p>
      </div>
      <CategoryTabs
        prefix="3d"
        syncSearchParam="tab"
        tabs={[
          { label: "z = f(x, y)", key: "height-field", render: () => <Linked3DView /> },
          { label: "Parametric surface", key: "parametric", render: () => <ParametricSurfacePanel /> },
        ]}
      />
    </div>
  );
}
