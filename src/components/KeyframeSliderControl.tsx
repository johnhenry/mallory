import { CellGraph } from "../lib/cell-graph.ts";
import { TIME_CELL } from "../lib/cell-ids.ts";
import { defaultSliderRange } from "../lib/free-vars.ts";
import { interpolateKeyframes, type Keyframe } from "../lib/timeline.ts";
import { useCell } from "../lib/use-cell.ts";

/**
 * Minimal structural shape a slider needs from a pane's cell-id namespace --
 * satisfied by both `CellIds` (GraphCanvas.tsx) and `CellIds3D`
 * (Graph3DCanvas.tsx) without either importing the other's concrete type.
 */
export interface KeyframeSliderIds {
  param(name: string): string;
  track(name: string): string;
}

/**
 * A free-variable slider that can be "held static" (plain range input) or
 * "animated" (a keyframe track driving the value off the shared `TIME_CELL`
 * clock) -- shared between the 2D (`GraphCanvas.tsx`) and 3D
 * (`Graph3DCanvas.tsx`) panes, which otherwise had byte-identical copies of
 * this logic.
 */
export function KeyframeSliderControl({ graph, ids, name }: { graph: CellGraph; ids: KeyframeSliderIds; name: string }) {
  const id = ids.param(name);
  const trackId = ids.track(name);
  const value = useCell<number>(graph, id) ?? defaultSliderRange(name).default;
  const track = useCell<Keyframe[] | undefined>(graph, trackId);
  const range = defaultSliderRange(name);
  const animated = track != null && track.length > 0;

  function toggleAnimated() {
    if (animated) {
      graph.set(id, value);
      graph.set(trackId, undefined);
    } else {
      graph.set(trackId, [{ t: 0, value }, { t: 3, value: range.max }]);
      graph.define(id, () => interpolateKeyframes(graph.get<Keyframe[]>(trackId), graph.get<number>(TIME_CELL)));
    }
  }

  function updateKeyframe(i: number, patch: Partial<Keyframe>) {
    if (!track) return;
    const next = track.map((k, idx) => (idx === i ? { ...k, ...patch } : k)).sort((a, b) => a.t - b.t);
    graph.set(trackId, next);
  }

  function addKeyframe() {
    if (!track) return;
    const lastT = track.length > 0 ? track[track.length - 1].t : 0;
    graph.set(trackId, [...track, { t: lastT + 1, value: range.default }]);
  }

  function removeKeyframe(i: number) {
    if (!track) return;
    graph.set(trackId, track.filter((_, idx) => idx !== i));
  }

  return (
    <div
      className="timeline-control"
      style={{ display: "flex", flexDirection: "column", fontSize: "0.85rem", border: "1px solid var(--border)", padding: "0.4rem" }}
    >
      <label style={{ display: "flex", flexDirection: "column" }}>
        {name} = {value.toFixed(2)}
        <input
          type="range"
          className="timeline-slider"
          min={range.min}
          max={range.max}
          step={range.step}
          value={value}
          disabled={animated}
          onChange={(e) => graph.set(id, Number(e.target.value))}
        />
      </label>
      <label>
        <input type="checkbox" checked={animated} onChange={toggleAnimated} /> Animate
      </label>
      {animated && track && (
        <div className="timeline-control">
          {track.map((k, i) => (
            <div key={i} style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}>
              <input
                type="number"
                aria-label={`keyframe ${i} time`}
                value={k.t}
                step={0.1}
                style={{ width: "4ch" }}
                onChange={(e) => updateKeyframe(i, { t: Number(e.target.value) })}
              />
              <span>s:</span>
              <input
                type="number"
                aria-label={`keyframe ${i} value`}
                value={k.value}
                step={range.step}
                style={{ width: "5ch" }}
                onChange={(e) => updateKeyframe(i, { value: Number(e.target.value) })}
              />
              {track.length > 1 && (
                <button type="button" onClick={() => removeKeyframe(i)}>
                  ×
                </button>
              )}
            </div>
          ))}
          <button type="button" onClick={addKeyframe}>
            + keyframe
          </button>
        </div>
      )}
    </div>
  );
}
