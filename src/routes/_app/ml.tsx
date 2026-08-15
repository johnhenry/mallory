import { createFileRoute } from "@tanstack/react-router";
import { MlPlaygroundPanel } from "~/components/MlPlaygroundPanel.tsx";

export const Route = createFileRoute("/_app/ml")({
  component: MlPage,
});

function MlPage() {
  return (
    <div>
      <div className="page-head">
        <p className="page-eyebrow">ML</p>
        <h1>Train a tiny network, watch it learn.</h1>
        <p className="lede">A seeded 2-layer MLP on toy datasets, trained in-browser -- decision boundary and loss curve, fully reproducible.</p>
      </div>
      <MlPlaygroundPanel />
    </div>
  );
}
