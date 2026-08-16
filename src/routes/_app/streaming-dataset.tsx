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
        <p className="lede">Two small demos making mallory-data's async Dataset pipeline visible: epoch reshuffling, and prefetch overlap timing.</p>
      </div>
      <StreamingDatasetPanel />
    </div>
  );
}
