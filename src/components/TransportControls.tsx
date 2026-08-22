import { CellGraph } from "@johnhenry/math";
import { TIME_CELL } from "../lib/cell-ids.ts";

/**
 * Play/Pause/Loop/Speed + a scrub slider bound to the shared TIME_CELL --
 * shared between GraphCanvas (2D) and Graph3DCanvas (3D), which otherwise
 * had byte-identical copies of this JSX. Renders nothing when there's
 * nothing to scrub (`duration <= 0`, e.g. no free variable is animated).
 */
export interface TransportControlsProps {
  graph: CellGraph;
  time: number;
  duration: number;
  playing: boolean;
  setPlaying: (playing: boolean | ((prev: boolean) => boolean)) => void;
  loop: boolean;
  setLoop: (loop: boolean) => void;
  speed: number;
  setSpeed: (speed: number) => void;
}

export function TransportControls({ graph, time, duration, playing, setPlaying, loop, setLoop, speed, setSpeed }: TransportControlsProps) {
  if (duration <= 0) return null;
  return (
    <div className="timeline-control" style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", margin: "0.5rem 0" }}>
      <button type="button" onClick={() => setPlaying((p) => !p)}>
        {playing ? "Pause" : "Play"}
      </button>
      <label>
        <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> Loop
      </label>
      <label>
        Speed{" "}
        <input
          type="number"
          value={speed}
          min={0.1}
          step={0.1}
          style={{ width: "4ch" }}
          onChange={(e) => setSpeed(Number(e.target.value))}
        />
      </label>
      <input
        type="range"
        className="timeline-slider"
        min={0}
        max={duration}
        step={0.01}
        value={Math.min(time, duration)}
        onChange={(e) => {
          setPlaying(false);
          graph.set(TIME_CELL, Number(e.target.value));
        }}
      />
      <span>
        {time.toFixed(2)}s / {duration.toFixed(2)}s
      </span>
    </div>
  );
}
