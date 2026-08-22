import { resamplePoly } from "@johnhenry/math-plus-signal";
import { Tensor } from "@johnhenry/math-plus-tensor-core";
import type { Waveform } from "./signal-waveform.ts";

/**
 * Resamples `waveform` to `up/down` times its original sample rate via
 * `mallory-signal`'s polyphase `resamplePoly` (issue #31's "extras" item) --
 * confirmed directly against the real installed package before writing this:
 * `up=1,down=1` is an exact identity (no filtering applied at all, per its
 * own source's early-return branch), and up-sampling produces exactly
 * `ceil(n*up/down)` interpolated samples matching a hand-computed sine
 * curve to 3 decimal places.
 *
 * The new sample rate is `waveform.sampleRate * up / down` -- e.g.
 * `up=1, down=2` halves the rate (downsampling), `up=2, down=1` doubles it
 * (upsampling). `t` is regenerated from the new rate/sample count rather
 * than reused, since resampling changes both.
 */
export function resampleWaveform(waveform: Waveform, up: number, down: number): Waveform {
  if (!Number.isInteger(up) || up < 1) throw new Error(`up must be a positive integer -- got ${up}.`);
  if (!Number.isInteger(down) || down < 1) throw new Error(`down must be a positive integer -- got ${down}.`);
  if (waveform.y.length === 0) throw new Error("Waveform must be non-empty.");

  const resampled = resamplePoly(Tensor.from(waveform.y), up, down);
  const newSampleRate = (waveform.sampleRate * up) / down;
  const n = resampled.shape[0]!;
  const t: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < n; i++) {
    t.push(i / newSampleRate);
    y.push(resampled.at(i) as number);
  }
  return { t, y, sampleRate: newSampleRate };
}
