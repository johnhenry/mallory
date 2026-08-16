/**
 * Two bounded demos for issue #58 ("make the invisible Dataset pipeline
 * visible"), both over synthetic in-memory data -- deliberately NOT the
 * issue's third candidate ("rate-limited fetch of a public dataset"),
 * which would add an external network dependency this repo's other demo
 * panels don't have.
 */
import { Dataset } from "mallory-data";

/**
 * Demo A: "watch epochs reshuffle". Runs a Dataset of `[0, size)` through
 * `epochs(epochCount, {reshuffle: {seed, bufferSize}})` and groups the
 * stream back into one array per epoch via `chunk(size)` -- each epoch
 * yields exactly `size` items before the next begins, so this is a clean
 * split with no manual bookkeeping.
 */
export async function runShuffleEpochsDemo(size: number, epochCount: number, seed: number, bufferSize?: number): Promise<number[][]> {
  if (size <= 0) throw new Error(`size must be positive -- got ${size}.`);
  if (epochCount <= 0) throw new Error(`epochCount must be positive -- got ${epochCount}.`);
  const source = () => Array.from({ length: size }, (_, i) => i);
  const stream = Dataset.from(source).epochs(epochCount, { reshuffle: { seed, bufferSize } });
  const chunks = await stream.chunk(size).toArray();
  return chunks;
}

/** Default injectable delay -- tests substitute a shorter one to keep the suite fast without changing the algorithm under test. */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface PrefetchTimingResult {
  /** Arrival time (ms since this run started) of each yielded item, in order. */
  withPrefetch: number[];
  withoutPrefetch: number[];
}

/**
 * Demo B: "prefetch vs no-prefetch timing". Simulates an I/O-bound
 * pipeline (`produceMs` per item) feeding a consumer that also does work
 * (`consumeMs` per item) between reads. Without `.prefetch()`, produce and
 * consume happen strictly back-to-back (~itemCount * (produceMs +
 * consumeMs) total); `.prefetch(n)` overlaps the next item's production
 * with the current item's consumption, so total wall time should trend
 * toward ~produceMs + itemCount * max(produceMs, consumeMs) instead --
 * the whole point being to make that overlap visible, not just assert it.
 */
export async function simulatePrefetchTiming(
  itemCount: number,
  produceMs: number,
  consumeMs: number,
  prefetchN: number,
  sleep: (ms: number) => Promise<void> = defaultSleep,
  /** Fires the instant each item arrives, before the simulated consume delay -- lets a caller render the timeline live rather than waiting for the whole run to finish. */
  onArrival?: (config: "withPrefetch" | "withoutPrefetch", index: number, ms: number) => void,
): Promise<PrefetchTimingResult> {
  if (itemCount <= 0) throw new Error(`itemCount must be positive -- got ${itemCount}.`);

  async function runOnce(config: "withPrefetch" | "withoutPrefetch"): Promise<number[]> {
    const start = Date.now();
    const arrivals: number[] = [];
    const source = () => Array.from({ length: itemCount }, (_, i) => i);
    let pipeline = Dataset.from(source).map(async (i: number) => {
      await sleep(produceMs);
      return i;
    });
    if (config === "withPrefetch") pipeline = pipeline.prefetch(prefetchN);
    for await (const _item of pipeline) {
      const ms = Date.now() - start;
      arrivals.push(ms);
      onArrival?.(config, arrivals.length - 1, ms);
      await sleep(consumeMs);
    }
    return arrivals;
  }

  const withPrefetch = await runOnce("withPrefetch");
  const withoutPrefetch = await runOnce("withoutPrefetch");
  return { withPrefetch, withoutPrefetch };
}
