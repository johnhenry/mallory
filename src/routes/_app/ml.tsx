import { createFileRoute } from "@tanstack/react-router";
import { CategoryTabs } from "~/components/CategoryTabs.tsx";
import { DigitClassifierPanel } from "~/components/DigitClassifierPanel.tsx";
import { MlPlaygroundPanel } from "~/components/MlPlaygroundPanel.tsx";

interface MlSearch {
  tab?: string;
}

/**
 * Issue #253's "fold Digit Classifier into the ML tab": both panels now
 * live under one `/ml` route, switched via `CategoryTabs`' `tab` search
 * param (the same pattern `data.tsx` already uses for its own Regression/
 * Statistics/.../Import tabs) rather than two separate sidebar entries.
 * `/digit-classifier`'s old URL still works -- it now redirects here with
 * `tab=digit-classifier` (see digit-classifier.tsx) instead of disappearing.
 *
 * A live-training section for the digit classifier (draw digits, train a
 * small classifier on them in the browser) is deliberately NOT built here
 * -- it's a materially bigger feature than folding an existing inference
 * demo into a shared tab strip, and is left as open follow-up work; today
 * this tab only carries over its existing pretrained-ONNX inference demo.
 */
export const Route = createFileRoute("/_app/ml")({
  validateSearch: (search: Record<string, unknown>): MlSearch => ({
    tab: typeof search.tab === "string" ? search.tab : undefined,
  }),
  component: MlPage,
});

function MlPage() {
  return (
    <div>
      <div className="page-head">
        <p className="page-eyebrow">ML</p>
        <h1>Train a tiny network, watch it learn.</h1>
        <p className="lede">
          A seeded 2-layer MLP on toy (or your own imported) datasets, trained in-browser, plus a real MNIST digit classifier demo running on
          onnxruntime-web.
        </p>
      </div>
      <CategoryTabs
        prefix="ml"
        syncSearchParam="tab"
        tabs={[
          { label: "Playground", key: "playground", render: () => <MlPlaygroundPanel /> },
          { label: "Digit Classifier", key: "digit-classifier", render: () => <DigitClassifierPanel /> },
        ]}
      />
    </div>
  );
}
