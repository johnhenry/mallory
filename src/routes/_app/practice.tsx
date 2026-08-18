import { createFileRoute } from "@tanstack/react-router";
import { PracticePanel } from "~/components/PracticePanel.tsx";

export const Route = createFileRoute("/_app/practice")({
  component: PracticePage,
});

function PracticePage() {
  return (
    <div>
      <div className="page-head">
        <p className="page-eyebrow">Practice</p>
        <h1>Sharpen your calculus and algebra.</h1>
        <p className="lede">
          Antiderivatives, derivatives, equation solving, and matrix determinants -- pick a mode and a difficulty, check your answer, or reveal
          it.
        </p>
      </div>
      <PracticePanel />
    </div>
  );
}
