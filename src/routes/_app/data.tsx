import { createFileRoute } from "@tanstack/react-router";
import { CategoryTabs } from "~/components/CategoryTabs.tsx";
import { MonteCarloPanel } from "~/components/MonteCarloPanel.tsx";
import { RegressionPanel } from "~/components/RegressionPanel.tsx";
import { StatisticsPanel } from "~/components/StatisticsPanel.tsx";
import { SystemSolverPanel } from "~/components/SystemSolverPanel.tsx";

interface DataSearch {
  tab?: string;
}

export const Route = createFileRoute("/_app/data")({
  validateSearch: (search: Record<string, unknown>): DataSearch => ({
    tab: typeof search.tab === "string" ? search.tab : undefined,
  }),
  component: DataPage,
});

function DataPage() {
  return (
    <div>
      <div className="page-head">
        <p className="page-eyebrow">Data &amp; Algebra</p>
        <h1>Fit, describe, solve.</h1>
        <p className="lede">Regression, statistics, and equation systems.</p>
      </div>
      <CategoryTabs
        prefix="data"
        syncSearchParam="tab"
        tabs={[
          { label: "Regression", key: "regression", render: () => <RegressionPanel /> },
          { label: "Statistics", key: "statistics", render: () => <StatisticsPanel /> },
          { label: "Systems", key: "systems", render: () => <SystemSolverPanel /> },
          { label: "Monte Carlo", key: "monte-carlo", render: () => <MonteCarloPanel /> },
        ]}
      />
    </div>
  );
}
