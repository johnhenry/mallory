import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { getExportVideoJob } from "../lib/export-video.ts";

export interface VideoExportControlsProps {
  /** Kick off the export job for the chosen format/duration; returns the job id to poll. */
  start: (format: "mp4" | "gif", duration: number) => Promise<{ jobId: string }>;
  /** Download filename stem (".mp4"/".gif" appended per format). */
  filenameStem: string;
  defaultDuration?: number;
  /**
   * Controlled duration -- when provided (with `onDurationChange`), the
   * caller owns this value instead of this component managing it
   * internally. Graph3DCanvas's scrub-preview (mallory-graph#9) needs to
   * read the same duration the Export button will use, to size its preview
   * slider's range to match; OdePanel (this component's other consumer)
   * has no such need and leaves both props unset, falling back to the
   * original internally-managed behavior unchanged.
   */
  duration?: number;
  onDurationChange?: (duration: number) => void;
}

/**
 * The start -> poll -> download flow shared by the 3D-surface and ODE
 * export sections (johnhenry/mallory-graph#3, pass 2) -- the same job-queue
 * client shape GraphCanvas's own export UI established (that one keeps its
 * bespoke inline version: it additionally owns a keyframe-driven duration
 * and a scrub preview this compact control deliberately doesn't).
 * Polling goes through export-video.ts's getExportVideoJob -- one shared
 * job store/poll endpoint for every export path.
 */
export function VideoExportControls({
  start,
  filenameStem,
  defaultDuration = 4,
  duration: controlledDuration,
  onDurationChange,
}: VideoExportControlsProps) {
  const [format, setFormat] = useState<"mp4" | "gif">("mp4");
  const [internalDuration, setInternalDuration] = useState(defaultDuration);
  const duration = controlledDuration ?? internalDuration;
  const setDuration = onDurationChange ?? setInternalDuration;
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const getExportVideoJobFn = useServerFn(getExportVideoJob);

  async function handleExport() {
    setExporting(true);
    setError(null);
    try {
      const { jobId } = await start(format, duration);
      const job = await new Promise<Awaited<ReturnType<typeof getExportVideoJobFn>>>((resolve, reject) => {
        const poll = () => {
          getExportVideoJobFn({ data: { jobId } }).then((status) => {
            if (status.status === "pending") setTimeout(poll, 1000);
            else resolve(status);
          }, reject);
        };
        poll();
      });
      if (job.status !== "done") {
        throw new Error(job.status === "error" ? job.message : "Export job did not complete.");
      }
      const bytes = Uint8Array.from(atob(job.result.data), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: job.result.mimeType }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${filenameStem}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div style={{ margin: "0.5rem 0", display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
      <label>
        duration (s):{" "}
        <input
          type="number"
          min={1}
          max={20}
          value={duration}
          onChange={(e) => setDuration(Math.max(1, Number(e.target.value) || defaultDuration))}
          style={{ font: "inherit", width: "5ch" }}
        />
      </label>
      <label>
        format:{" "}
        <select value={format} onChange={(e) => setFormat(e.target.value as "mp4" | "gif")} style={{ font: "inherit" }}>
          <option value="mp4">mp4</option>
          <option value="gif">gif</option>
        </select>
      </label>
      <button type="button" onClick={handleExport} disabled={exporting}>
        {exporting ? "Exporting…" : "Export video"}
      </button>
      {error && <span style={{ color: "var(--danger)", fontSize: "0.85rem" }}>{error}</span>}
    </div>
  );
}
