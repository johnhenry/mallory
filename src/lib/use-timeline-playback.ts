import { useEffect } from "react";
import { CellGraph } from "@johnhenry/math";
import { TIME_CELL } from "./cell-ids.ts";

/**
 * Advances the shared TIME_CELL by real elapsed time (scaled by `speed`)
 * every frame while `playing`, looping back to 0 at `duration` or stopping
 * there -- shared between GraphCanvas (2D) and Graph3DCanvas (3D), which
 * otherwise had byte-identical copies of this effect.
 */
export function useTimelinePlayback(
  graph: CellGraph,
  playing: boolean,
  loop: boolean,
  speed: number,
  duration: number,
  setPlaying: (playing: boolean) => void,
): void {
  useEffect(() => {
    if (!playing || duration <= 0) return;
    let raf = 0;
    let last = performance.now();
    function tick(now: number) {
      const dt = ((now - last) / 1000) * speed;
      last = now;
      let next = graph.get<number>(TIME_CELL) + dt;
      if (next >= duration) {
        if (loop) next %= duration;
        else {
          next = duration;
          setPlaying(false);
        }
      }
      graph.set(TIME_CELL, next);
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, loop, speed, duration, graph, setPlaying]);
}
