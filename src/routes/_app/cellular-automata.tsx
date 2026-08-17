import { createFileRoute } from "@tanstack/react-router";
import { CellularAutomataPanel } from "~/components/CellularAutomataPanel.tsx";

export const Route = createFileRoute("/_app/cellular-automata")({
  component: CellularAutomataPage,
});

function CellularAutomataPage() {
  return (
    <div>
      <div className="page-head">
        <p className="page-eyebrow">Cellular automata</p>
        <h1>n-D cellular automata laboratory.</h1>
        <p className="lede">Pick a dimension and a known rule, then watch its space-time history unfold -- 1D as a 2D image, 2D as an animated grid and a 3D voxel stack.</p>
      </div>
      <CellularAutomataPanel />
    </div>
  );
}
