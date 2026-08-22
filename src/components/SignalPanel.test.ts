import assert from "node:assert/strict";
import { test } from "node:test";
import { Symbolic } from "@johnhenry/math";
import { buildSumOfSinusoidsExpr, spectrumPlot, waveformPlot } from "./SignalPanel.tsx";

test("buildSumOfSinusoidsExpr: a single term formats as A*sin(2*pi*f*t+p)", () => {
  assert.equal(buildSumOfSinusoidsExpr([{ amplitude: "1", frequency: "5", phase: "0" }]), "1*sin(2*pi*5*t+0)");
});

test("buildSumOfSinusoidsExpr: multiple terms join with ' + '", () => {
  const expr = buildSumOfSinusoidsExpr([
    { amplitude: "1", frequency: "5", phase: "0" },
    { amplitude: "0.5", frequency: "12", phase: "0.3" },
  ]);
  assert.equal(expr, "1*sin(2*pi*5*t+0) + 0.5*sin(2*pi*12*t+0.3)");
});

test("buildSumOfSinusoidsExpr: a term with any blank field is skipped (mid-edit row doesn't break the whole expression)", () => {
  const expr = buildSumOfSinusoidsExpr([
    { amplitude: "1", frequency: "5", phase: "0" },
    { amplitude: "", frequency: "12", phase: "0" },
    { amplitude: "2", frequency: "", phase: "0" },
    { amplitude: "3", frequency: "7", phase: "" },
  ]);
  assert.equal(expr, "1*sin(2*pi*5*t+0)");
});

test('buildSumOfSinusoidsExpr: an empty (or all-blank) term list falls back to the literal "0"', () => {
  assert.equal(buildSumOfSinusoidsExpr([]), "0");
  assert.equal(buildSumOfSinusoidsExpr([{ amplitude: "", frequency: "5", phase: "0" }]), "0");
});

test("buildSumOfSinusoidsExpr: the generated string parses and evaluates correctly against a hand-computed (plain Math.sin) reference", () => {
  const expr = buildSumOfSinusoidsExpr([
    { amplitude: "1", frequency: "5", phase: "0" },
    { amplitude: "0.5", frequency: "12", phase: "0.3" },
  ]);
  const compiled = Symbolic.compile(Symbolic.parse(expr), { declaredVariables: ["t"] });
  for (const t of [0, 0.02, 0.137]) {
    const expected = 1 * Math.sin(2 * Math.PI * 5 * t + 0) + 0.5 * Math.sin(2 * Math.PI * 12 * t + 0.3);
    const actual = compiled({ t }) as number;
    assert.ok(Math.abs(actual - expected) < 1e-9, `t=${t}: expected ${expected}, got ${actual}`);
  }
});

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
