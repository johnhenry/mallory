/**
 * Bounded demos for issue #58 ("make the invisible Dataset pipeline
 * visible") plus issue #259's follow-up examples, all over synthetic
 * in-memory data -- deliberately NOT the issue's third candidate
 * ("rate-limited fetch of a public dataset"), which would add an external
 * network dependency this repo's other demo panels don't have.
 */
import { Dataset } from "@johnhenry/math-plus-data";
import { mapConcurrentAsync, teeAsync, windowedAsync } from "@johnhenry/iteration";

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

export interface ConcurrentOrderingResult {
  /** Original indices, in the order `mapConcurrentAsync` yielded them with `ordered: true`. */
  ordered: number[];
  /** Original indices, in the order `mapConcurrentAsync` yielded them with `ordered: false`. */
  unordered: number[];
}

/**
 * Demo C: "ordered vs. completion-order concurrent map". `mapConcurrentAsync`
 * runs up to `concurrency` invocations of a (simulated) async transform at
 * once; `durationsMs[i % durationsMs.length]` gives item `i` a variable
 * amount of simulated work so some finish faster than others. With
 * `ordered: true` (@johnhenry/iteration's default) the output always comes back
 * in input order -- a fast item still has to wait for every slower item
 * ahead of it. With `ordered: false` items are yielded in completion order,
 * so fast items can overtake slow ones that started earlier. Same
 * `concurrency` and `durationsMs` feed both runs, so the only variable is
 * the ordering mode -- making that specific trade-off (latency vs. a
 * stable, index-addressable output order) visible side by side.
 */
export async function runConcurrentOrderingDemo(
  itemCount: number,
  durationsMs: number[],
  concurrency: number,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<ConcurrentOrderingResult> {
  if (itemCount <= 0) throw new Error(`itemCount must be positive -- got ${itemCount}.`);
  if (concurrency <= 0) throw new Error(`concurrency must be positive -- got ${concurrency}.`);
  if (durationsMs.length === 0) throw new Error("durationsMs must contain at least one value.");

  async function runOnce(ordered: boolean): Promise<number[]> {
    const source = Array.from({ length: itemCount }, (_, i) => i);
    const seq: number[] = [];
    const pipeline = mapConcurrentAsync(
      async (i: number) => {
        await sleep(durationsMs[i % durationsMs.length] as number);
        return i;
      },
      source,
      { concurrency, ordered },
    );
    for await (const i of pipeline) {
      seq.push(i);
    }
    return seq;
  }

  const ordered = await runOnce(true);
  const unordered = await runOnce(false);
  return { ordered, unordered };
}

/** Deterministic PRNG (mulberry32) -- small, seedable, and dependency-free; good enough for a synthetic noisy signal, not for cryptography. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generates `n` samples of a sine wave plus seeded pseudo-random noise
 * (uniform in `[-noiseAmplitude, noiseAmplitude]`) -- the raw signal that
 * {@link computeWindowedAverage} smooths in Demo D.
 */
export function generateNoisySignal(n: number, seed: number, noiseAmplitude: number): number[] {
  if (n <= 0) throw new Error(`n must be positive -- got ${n}.`);
  const rand = mulberry32(seed);
  return Array.from({ length: n }, (_, i) => {
    const noise = (rand() * 2 - 1) * noiseAmplitude;
    return Math.sin(i / 3) + noise;
  });
}

/**
 * Demo D: "sliding-window smoothing". Runs `values` through
 * `windowedAsync(values, windowSize)` -- @johnhenry/iteration's overlapping
 * fixed-size window over a stream -- and averages each window, producing a
 * moving average with `values.length - windowSize + 1` points. A bigger
 * `windowSize` averages over more neighbors, trading responsiveness for
 * smoothness; this is the same sliding-window primitive behind streaming
 * moving averages, rolling metrics dashboards, and audio/signal smoothing.
 */
export async function computeWindowedAverage(values: number[], windowSize: number): Promise<number[]> {
  if (windowSize <= 0) throw new Error(`windowSize must be positive -- got ${windowSize}.`);
  if (windowSize > values.length) throw new Error(`windowSize (${windowSize}) must not exceed values.length (${values.length}).`);
  const out: number[] = [];
  for await (const window of windowedAsync(values, windowSize)) {
    out.push(window.reduce((a, b) => a + b, 0) / window.length);
  }
  return out;
}

export interface TeeConsumersResult {
  /** Arrival time (ms since this run started) of each item the fast consumer read off its branch. */
  fastArrivals: number[];
  /** Arrival time (ms since this run started) of each item the slow consumer read off its branch. */
  slowArrivals: number[];
}

/**
 * Demo E: "tee -- independent consumers, unbounded buffering". `teeAsync(2)`
 * splits one source into 2 independent branches; each branch can be
 * iterated at its own pace, with items the faster branch has already
 * consumed held in a per-branch buffer until the slower branch catches up.
 * Unlike {@link simulatePrefetchTiming}'s `.prefetch(n)` -- which caps how
 * far ahead the producer gets with a bounded buffer of size `n` -- `tee`
 * places no bound on that buffer at all: the fast consumer here finishes in
 * roughly `itemCount * max(produceMs, fastConsumeMs)`, completely
 * unaffected by how slow the other branch is, while the slow branch's
 * buffer of not-yet-read items grows for as long as it lags. Both branches
 * still see every item, in the same order.
 */
export async function simulateTeeConsumers(
  itemCount: number,
  produceMs: number,
  fastConsumeMs: number,
  slowConsumeMs: number,
  sleep: (ms: number) => Promise<void> = defaultSleep,
  /** Fires the instant each item arrives on a branch, before that branch's simulated consume delay -- `item` is the original 0-based item value (both branches must see 0, 1, 2, ... in order; a mismatch would indicate the branches desynced). */
  onArrival?: (branch: "fast" | "slow", item: number, ms: number) => void,
): Promise<TeeConsumersResult> {
  if (itemCount <= 0) throw new Error(`itemCount must be positive -- got ${itemCount}.`);

  const start = Date.now();
  async function* produce(): AsyncGenerator<number> {
    for (let i = 0; i < itemCount; i++) {
      await sleep(produceMs);
      yield i;
    }
  }
  const [fastBranch, slowBranch] = teeAsync(2)(produce()) as [AsyncGenerator<number>, AsyncGenerator<number>];

  // Two branches reading the same tee'd source concurrently is the whole
  // point of this demo, but a `.next()` call issued on one branch while the
  // other branch's `.next()` call is *also* in flight against a still-empty
  // buffer is unspecified -- both would pull directly from the shared
  // source instead of one filling the other's buffer, which can misalign
  // which item each branch sees. Serializing just the moment each branch
  // asks the tee for its next item (not the surrounding produce/consume
  // delays, which still overlap freely) sidesteps that without giving up
  // the independent pacing this demo is about.
  let nextCallChain: Promise<unknown> = Promise.resolve();
  function serializedNext<T>(branch: AsyncGenerator<T>): Promise<IteratorResult<T>> {
    const result = nextCallChain.then(() => branch.next());
    nextCallChain = result.catch(() => {});
    return result;
  }

  async function consume(branch: AsyncGenerator<number>, consumeMs: number, tag: "fast" | "slow"): Promise<number[]> {
    const arrivals: number[] = [];
    while (true) {
      const r = await serializedNext(branch);
      if (r.done) break;
      const ms = Date.now() - start;
      arrivals.push(ms);
      onArrival?.(tag, r.value, ms);
      await sleep(consumeMs);
    }
    return arrivals;
  }

  const [fastArrivals, slowArrivals] = await Promise.all([consume(fastBranch, fastConsumeMs, "fast"), consume(slowBranch, slowConsumeMs, "slow")]);
  return { fastArrivals, slowArrivals };
}
