import assert from "node:assert/strict";
import { test } from "node:test";
import { spectrumPlot, waveformPlot } from "./SignalPanel.tsx";

test("waveformPlot: viewport spans the sample time range and +/-1.1x the peak absolute amplitude", () => {
  const { points, viewport } = waveformPlot({ t: [0, 0.5, 1], y: [1, -3, 2], sampleRate: 2 });
  assert.deepEqual(points, [
    { x: 0, y: 1 },
    { x: 0.5, y: -3 },
    { x: 1, y: 2 },
  ]);
  assert.equal(viewport.xMin, 0);
  assert.equal(viewport.xMax, 1);
  assert.ok(Math.abs(viewport.yMin - -3.3) < 1e-12, `yMin: ${viewport.yMin}`);
  assert.ok(Math.abs(viewport.yMax - 3.3) < 1e-12, `yMax: ${viewport.yMax}`);
});

test("waveformPlot: an all-zero waveform gets a tiny non-zero viewport height (the 1e-9 floor), not a degenerate [0,0] range", () => {
  const { viewport } = waveformPlot({ t: [0, 1], y: [0, 0], sampleRate: 1 });
  assert.ok(viewport.yMax > 0);
  assert.equal(viewport.yMin, -viewport.yMax);
});

test("spectrumPlot: viewport spans [0, highest frequency] x [0, +1.1x peak amplitude]", () => {
  const { points, viewport } = spectrumPlot({ frequencies: [0, 5, 10], amplitudes: [2, 4, 1] });
  assert.deepEqual(points, [
    { x: 0, y: 2 },
    { x: 5, y: 4 },
    { x: 10, y: 1 },
  ]);
  assert.equal(viewport.xMin, 0);
  assert.equal(viewport.xMax, 10);
  assert.equal(viewport.yMin, 0);
  assert.ok(Math.abs(viewport.yMax - 4.4) < 1e-12, `yMax: ${viewport.yMax}`);
});
