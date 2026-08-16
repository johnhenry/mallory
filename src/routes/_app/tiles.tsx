import { createFileRoute } from "@tanstack/react-router";
import { TilesPanel } from "~/components/TilesPanel.tsx";

export const Route = createFileRoute("/_app/tiles")({
  component: TilesPage,
});

function TilesPage() {
  return (
    <div>
      <div className="page-head">
        <p className="page-eyebrow">Tiles</p>
        <h1>Wang tile laboratory.</h1>
        <p className="lede">Edit a tile set, pick a solver, and watch the backtracking search play back step by step.</p>
      </div>
      <TilesPanel />
    </div>
  );
}
