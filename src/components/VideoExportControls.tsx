import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { getExportVideoJob } from "../lib/export-video.ts";
import { pollUntilSettled } from "../lib/poll-job.ts";

export interface VideoExportControlsProps {
  /** Kick off the export job for the chosen format/duration; returns the job id to poll. */
  start: (format: "mp4" | "gif", duration: number) => Promise<{ jobId: string }>;
  /** Download filename stem (".mp4"/".gif" appended per format). */
  filenameStem: string;
  defaultDuration?: number;
  /**
   * Controlled duration -- when provided (with `onDurationChange`), the
   * caller owns this value instead of this component managing it
   * internally. Graph3DCanvas's scrub-preview (mallory#9) needs to
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
 * export sections (johnhenry/mallory#3, pass 2) -- the same job-queue
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

  // Guards every post-await state update below against firing on an
  // unmounted component (issue #237): the poll loop itself now stops via
  // pollUntilSettled's `isCancelled`, but `start()`'s own await and the
  // final download step need the same check.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function handleExport() {
    setExporting(true);
    setError(null);
    try {
      const { jobId } = await start(format, duration);
      const job = await pollUntilSettled(() => getExportVideoJobFn({ data: { jobId } }), () => !mountedRef.current);
      if (!mountedRef.current) return; // unmounted (navigated away) before the job settled -- nothing left to update
      if (!job || job.status !== "done") {
        throw new Error(job?.status === "error" ? job.message : "Export job did not complete.");
      }
      const bytes = Uint8Array.from(atob(job.result.data), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: job.result.mimeType }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${filenameStem}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      if (mountedRef.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mountedRef.current) setExporting(false);
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
