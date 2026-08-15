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
        <h1>Named variables, shared across every panel.</h1>
        <p className="lede">Define k = 3 here once, and it's available anywhere "k" appears in an expression -- no notebook required.</p>
      </div>
      <WorkspacePanel />
    </div>
  );
}
