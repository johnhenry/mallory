import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveFilterCommand } from "./nl-query-filter.ts";

test("resolveFilterCommand: 'low-pass at 40 Hz' resolves to lowpass/40, hand-computed", () => {
  assert.deepEqual(resolveFilterCommand("low-pass at 40 Hz"), { filterType: "lowpass", filterCutoffHz: "40" });
});

test("resolveFilterCommand: 'high-pass at 100 Hz' resolves to highpass/100", () => {
  assert.deepEqual(resolveFilterCommand("high-pass at 100 Hz"), { filterType: "highpass", filterCutoffHz: "100" });
});

test("resolveFilterCommand: accepts spacing/casing/'filter' variants -- 'lowpass', 'low pass', 'LOWPASS FILTER', 'highpass filter'", () => {
  assert.deepEqual(resolveFilterCommand("lowpass at 20 hz"), { filterType: "lowpass", filterCutoffHz: "20" });
  assert.deepEqual(resolveFilterCommand("low pass at 20 hz"), { filterType: "lowpass", filterCutoffHz: "20" });
  assert.deepEqual(resolveFilterCommand("LOWPASS FILTER AT 20 HZ"), { filterType: "lowpass", filterCutoffHz: "20" });
  assert.deepEqual(resolveFilterCommand("highpass filter at 20 hz"), { filterType: "highpass", filterCutoffHz: "20" });
});

test("resolveFilterCommand: a fractional cutoff frequency parses correctly", () => {
  assert.deepEqual(resolveFilterCommand("low-pass at 12.5 Hz"), { filterType: "lowpass", filterCutoffHz: "12.5" });
});

test("resolveFilterCommand: 'band-pass between 200 and 800 Hz' resolves to bandpass/[200,800], hand-computed", () => {
  assert.deepEqual(resolveFilterCommand("band-pass between 200 and 800 Hz"), {
    filterType: "bandpass",
    filterCutoffHz: "200",
    filterCutoffHzHigh: "800",
  });
});

test("resolveFilterCommand: 'bandstop from 100 to 300 hz' resolves to bandstop/[100,300]", () => {
  assert.deepEqual(resolveFilterCommand("bandstop from 100 to 300 hz"), {
    filterType: "bandstop",
    filterCutoffHz: "100",
    filterCutoffHzHigh: "300",
  });
});

test("resolveFilterCommand: band phrasing accepts spacing/casing/'filter' variants and a fractional cutoff", () => {
  assert.deepEqual(resolveFilterCommand("bandpass between 200 and 800 hz"), { filterType: "bandpass", filterCutoffHz: "200", filterCutoffHzHigh: "800" });
  assert.deepEqual(resolveFilterCommand("band stop filter from 100 to 300 hz"), {
    filterType: "bandstop",
    filterCutoffHz: "100",
    filterCutoffHzHigh: "300",
  });
  assert.deepEqual(resolveFilterCommand("BAND-PASS BETWEEN 200 AND 800 HZ"), { filterType: "bandpass", filterCutoffHz: "200", filterCutoffHzHigh: "800" });
  assert.deepEqual(resolveFilterCommand("band-pass between 12.5 and 30 hz"), { filterType: "bandpass", filterCutoffHz: "12.5", filterCutoffHzHigh: "30" });
});

test("resolveFilterCommand: an old-style 'band-pass at 40 Hz' (single frequency, no range) does not match -- band types need two frequencies", () => {
  assert.equal(resolveFilterCommand("band-pass at 40 Hz"), null);
  assert.equal(resolveFilterCommand("bandstop at 40 Hz"), null);
});

test("resolveFilterCommand: a plain math expression does not match", () => {
  assert.equal(resolveFilterCommand("sin(2*pi*40*t)"), null);
  assert.equal(resolveFilterCommand("derivative of sin(t)"), null);
});

test("resolveFilterCommand: missing the frequency or unit does not match", () => {
  assert.equal(resolveFilterCommand("low-pass filter"), null);
  assert.equal(resolveFilterCommand("low-pass at 40"), null);
});

test("resolveFilterCommand: missing the 'at' keyword does not match", () => {
  assert.equal(resolveFilterCommand("low-pass 40 hz"), null);
});
