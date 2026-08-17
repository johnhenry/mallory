import { useRef, useState } from "react";

export interface ExportPreviewScrubberProps {
  /** Upper bound of the scrub range -- the export's own duration (plus any prelude the caller's clip plays before it, e.g. 2D's root-crossing Flash). */
  maxTime: number;
  /** Render one still frame at `time` seconds; shares the export's own scene-construction so the preview can't drift from the real render. */
  fetchFrame: (time: number) => Promise<{ data: string; mimeType: string }>;
}

/**
 * A scrub slider that renders a single preview frame on release (not per
 * drag tick -- a frame render is fast but not free). Mirrors GraphCanvas's
 * inline 2D preview slider; extracted here for Graph3DCanvas's surface
 * export (mallory-graph#9) rather than generalizing GraphCanvas's own
 * already-shipped copy, to avoid touching working, already-verified 2D
 * behavior for a change scoped to 3D.
 */
export function ExportPreviewScrubber({ maxTime, fetchFrame }: ExportPreviewScrubberProps) {
  const [time, setTime] = useState(0);
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Request-generation counter (issue #237): dragging, releasing, then
  // dragging+releasing again before the first release's fetchFrame resolves
  // fires two overlapping fetches. Incremented per call, checked before
  // applying a result so a slow earlier release can't overwrite the preview
  // for a since-superseded, faster-resolving later one.
  const requestIdRef = useRef(0);

  async function fetchAt(t: number) {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const frame = await fetchFrame(t);
      if (requestId !== requestIdRef.current) return; // a later release already fetched a newer frame
      setSrc(`data:${frame.mimeType};base64,${frame.data}`);
    } catch (e) {
      if (requestId !== requestIdRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }

  return (
    <div style={{ margin: "0.5rem 0" }}>
      <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Export preview</span>
        <input
          type="range"
          min={0}
          max={maxTime}
          step={0.05}
          value={time}
          onChange={(e) => setTime(Number(e.target.value))}
          onPointerUp={() => void fetchAt(time)}
          onKeyUp={() => void fetchAt(time)}
        />
        <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
          {time.toFixed(2)}s{loading ? " — rendering…" : src ? "" : " — release to preview"}
        </span>
      </label>
      {src && (
        <img
          src={src}
          alt={`Export preview frame at ${time.toFixed(2)}s`}
          width={160}
          height={160}
          style={{ border: "1px solid var(--border)", display: "block", marginTop: "0.25rem", opacity: loading ? 0.5 : 1 }}
        />
      )}
      {error && <span style={{ color: "var(--danger)", fontSize: "0.85rem" }}>{error}</span>}
    </div>
  );
}
