import { createFileRoute } from "@tanstack/react-router";
import { CategoryTabs } from "~/components/CategoryTabs.tsx";
import { Ode2Panel } from "~/components/Ode2Panel.tsx";
import { OdePanel } from "~/components/OdePanel.tsx";
import { OdeSystemPanel } from "~/components/OdeSystemPanel.tsx";

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
        <h1>Differential equations.</h1>
        <p className="lede">One equation, or a coupled system.</p>
      </div>
      <CategoryTabs
        prefix="calculus"
        syncSearchParam="tab"
        tabs={[
          { label: "Single ODE", key: "ode", render: () => <OdePanel /> },
          { label: "2nd-Order ODE", key: "ode2", render: () => <Ode2Panel /> },
          { label: "ODE System", key: "ode-system", render: () => <OdeSystemPanel /> },
        ]}
      />
    </div>
  );
}
