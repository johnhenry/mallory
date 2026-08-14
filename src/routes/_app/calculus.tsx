import { createFileRoute } from "@tanstack/react-router";
import { CategoryTabs } from "~/components/CategoryTabs.tsx";
import { Ode2Panel } from "~/components/Ode2Panel.tsx";
import { OdePanel } from "~/components/OdePanel.tsx";
import { OdeSystemPanel } from "~/components/OdeSystemPanel.tsx";
import { SeriesPanel } from "~/components/SeriesPanel.tsx";
import { TaylorPanel } from "~/components/TaylorPanel.tsx";

interface CalculusSearch {
  tab?: string;
}

export const Route = createFileRoute("/_app/calculus")({
  validateSearch: (search: Record<string, unknown>): CalculusSearch => ({
    tab: typeof search.tab === "string" ? search.tab : undefined,
  }),
  component: CalculusPage,
});

function CalculusPage() {
  return (
    <div>
      <div className="page-head">
        <p className="page-eyebrow">Calculus</p>
        <h1>Differential equations, series, and limits.</h1>
        <p className="lede">One equation, a coupled system, or a Taylor approximation.</p>
      </div>
      <CategoryTabs
        prefix="calculus"
        syncSearchParam="tab"
        tabs={[
          { label: "Single ODE", key: "ode", render: () => <OdePanel /> },
          { label: "2nd-Order ODE", key: "ode2", render: () => <Ode2Panel /> },
          { label: "ODE System", key: "ode-system", render: () => <OdeSystemPanel /> },
          { label: "Taylor & Limits", key: "taylor", render: () => <TaylorPanel /> },
          { label: "Series", key: "series", render: () => <SeriesPanel /> },
        ]}
      />
    </div>
  );
}
