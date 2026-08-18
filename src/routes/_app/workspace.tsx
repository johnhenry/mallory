import { createFileRoute } from "@tanstack/react-router";
import { WorkspacePanel } from "~/components/WorkspacePanel.tsx";

export const Route = createFileRoute("/_app/workspace")({
  component: WorkspacePage,
});

function WorkspacePage() {
  return (
    <div>
      <div className="page-head">
        <p className="page-eyebrow">Workspace</p>
        <h1>Named numeric variables, usable in a few specific places.</h1>
        <p className="lede">
          Define k = 3 here once and it overrides any matching free variable -- but only on the panels that
          actually check the workspace (see below). It's not yet wired into every panel.
        </p>
      </div>
      <WorkspacePanel />
    </div>
  );
}
