import { createFileRoute } from "@tanstack/react-router";
import { StreamingDatasetPanel } from "~/components/StreamingDatasetPanel.tsx";

export const Route = createFileRoute("/_app/streaming-dataset")({
  component: StreamingDatasetPage,
});

function StreamingDatasetPage() {
  return (
    <div>
      <div className="page-head">
        <p className="page-eyebrow">Streaming dataset</p>
        <h1>Watch a Dataset pipeline run.</h1>
        <p className="lede">
          Five small demos making mallory-data/mallory-iteration's async streaming primitives visible: epoch reshuffling, prefetch overlap timing,
          concurrent-map ordering, sliding-window smoothing, and tee's independent consumers.
        </p>
      </div>
      <StreamingDatasetPanel />
    </div>
  );
}
