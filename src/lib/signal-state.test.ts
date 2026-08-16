import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_SIGNAL_STATE,
  decodeSignalState,
  encodeSignalState,
  isSignalStateV1,
  isSignalStateV2,
  type SignalStateV1,
} from "./signal-state.ts";

test("encodeSignalState/decodeSignalState: round-trips the default state", () => {
  const encoded = encodeSignalState(DEFAULT_SIGNAL_STATE);
  const decoded = decodeSignalState(encoded);
  assert.deepEqual(decoded, DEFAULT_SIGNAL_STATE);
});

test("decodeSignalState: returns null for garbage input rather than throwing", () => {
  assert.equal(decodeSignalState("not-valid-base64url!!"), null);
});

test("decodeSignalState: upgrades a v1 payload to v2, defaulting the spectrogram fields", () => {
  const v1: SignalStateV1 = { v: 1, exprText: "sin(2*pi*3*t)", sampleRate: "128", duration: "2" };
  const encoded = Buffer.from(JSON.stringify(v1)).toString("base64url");
  const decoded = decodeSignalState(encoded);
  assert.ok(decoded);
  assert.equal(decoded.v, 2);
  assert.equal(decoded.exprText, "sin(2*pi*3*t)");
  assert.equal(decoded.sampleRate, "128");
  assert.equal(decoded.nperseg, DEFAULT_SIGNAL_STATE.nperseg);
  assert.equal(decoded.noverlap, DEFAULT_SIGNAL_STATE.noverlap);
});

test("isSignalStateV1/isSignalStateV2: distinguish the two shapes by their v tag", () => {
  const v1: SignalStateV1 = { v: 1, exprText: "t", sampleRate: "8", duration: "1" };
  assert.equal(isSignalStateV1(v1), true);
  assert.equal(isSignalStateV2(v1), false);
  assert.equal(isSignalStateV2(DEFAULT_SIGNAL_STATE), true);
});

test("isSignalStateV2: accepts a pre-#31 v2 state missing the peak-finding fields entirely (an old encoded URL hash)", () => {
  const prePeaksState = { v: 2, exprText: "sin(t)", sampleRate: "64", duration: "1", nperseg: "16", noverlap: "8" };
  assert.equal(isSignalStateV2(prePeaksState), true);
});

test("isSignalStateV2: rejects a peak-finding field with the wrong type when present", () => {
  const badShowPeaks = { ...DEFAULT_SIGNAL_STATE, showPeaks: "yes" };
  assert.equal(isSignalStateV2(badShowPeaks), false);
  const badMinAmplitude = { ...DEFAULT_SIGNAL_STATE, minAmplitude: 4 };
  assert.equal(isSignalStateV2(badMinAmplitude), false);
});

test("decodeSignalState: a pre-#31 encoded fragment (no peak-finding fields) decodes successfully rather than falling back to defaults", () => {
  const prePeaksState = { v: 2, exprText: "sin(t)", sampleRate: "64", duration: "1", nperseg: "16", noverlap: "8" };
  const encoded = Buffer.from(JSON.stringify(prePeaksState)).toString("base64url");
  const decoded = decodeSignalState(encoded);
  assert.notEqual(decoded, null);
  assert.equal(decoded?.exprText, "sin(t)");
  assert.equal(decoded?.showPeaks, undefined);
});

test("isSignalStateV2: accepts a v2 state missing the cross-correlation fields entirely (an old encoded URL hash from before that feature existed)", () => {
  const preCorrelationState = { v: 2, exprText: "sin(t)", sampleRate: "64", duration: "1", nperseg: "16", noverlap: "8" };
  assert.equal(isSignalStateV2(preCorrelationState), true);
});

test("isSignalStateV2: rejects a cross-correlation field with the wrong type when present", () => {
  const badShowCorrelation = { ...DEFAULT_SIGNAL_STATE, showCorrelation: "yes" };
  assert.equal(isSignalStateV2(badShowCorrelation), false);
  const badExprTextB = { ...DEFAULT_SIGNAL_STATE, exprTextB: 4 };
  assert.equal(isSignalStateV2(badExprTextB), false);
});

test("encodeSignalState/decodeSignalState: round-trips the full state including the new peak-finding fields", () => {
  const state = { ...DEFAULT_SIGNAL_STATE, showPeaks: true, minAmplitude: "0.5", minSpacingHz: "2", minProminence: "0.1" };
  const decoded = decodeSignalState(encodeSignalState(state));
  assert.deepEqual(decoded, state);
});

test("isSignalStateV2: accepts a v2 state missing the resample fields entirely (an old encoded URL hash from before that feature existed)", () => {
  const preResampleState = { v: 2, exprText: "sin(t)", sampleRate: "64", duration: "1", nperseg: "16", noverlap: "8" };
  assert.equal(isSignalStateV2(preResampleState), true);
});

test("isSignalStateV2: rejects a resample field with the wrong type when present", () => {
  const badShowResample = { ...DEFAULT_SIGNAL_STATE, showResample: "yes" };
  assert.equal(isSignalStateV2(badShowResample), false);
  const badResampleUp = { ...DEFAULT_SIGNAL_STATE, resampleUp: 2 };
  assert.equal(isSignalStateV2(badResampleUp), false);
});

test("isSignalStateV2: accepts a v2 state missing the sum-of-sinusoids builder fields entirely (an old encoded URL hash from before that feature existed)", () => {
  const preBuilderState = { v: 2, exprText: "sin(t)", sampleRate: "64", duration: "1", nperseg: "16", noverlap: "8" };
  assert.equal(isSignalStateV2(preBuilderState), true);
});

test("isSignalStateV2: rejects a malformed builderTerms field (wrong shape entirely, or a term missing a required string field)", () => {
  const badUseBuilder = { ...DEFAULT_SIGNAL_STATE, useBuilder: "yes" };
  assert.equal(isSignalStateV2(badUseBuilder), false);
  const notAnArray = { ...DEFAULT_SIGNAL_STATE, builderTerms: "nope" };
  assert.equal(isSignalStateV2(notAnArray), false);
  const missingField = { ...DEFAULT_SIGNAL_STATE, builderTerms: [{ amplitude: "1", frequency: "5" }] };
  assert.equal(isSignalStateV2(missingField), false);
  const wrongFieldType = { ...DEFAULT_SIGNAL_STATE, builderTerms: [{ amplitude: 1, frequency: "5", phase: "0" }] };
  assert.equal(isSignalStateV2(wrongFieldType), false);
});

test("encodeSignalState/decodeSignalState: round-trips the full state including builder terms", () => {
  const state = {
    ...DEFAULT_SIGNAL_STATE,
    useBuilder: true,
    builderTerms: [{ amplitude: "2", frequency: "3", phase: "1.5" }],
  };
  const decoded = decodeSignalState(encodeSignalState(state));
  assert.deepEqual(decoded, state);
});

test("isSignalStateV2: accepts a v2 state missing the filter-design fields entirely (an old encoded URL hash from before that feature existed)", () => {
  const preFilterState = { v: 2, exprText: "sin(t)", sampleRate: "64", duration: "1", nperseg: "16", noverlap: "8" };
  assert.equal(isSignalStateV2(preFilterState), true);
});

test("isSignalStateV2: rejects a filter-design field with the wrong type when present", () => {
  const badShowFilter = { ...DEFAULT_SIGNAL_STATE, showFilter: "yes" };
  assert.equal(isSignalStateV2(badShowFilter), false);
  const badFilterOrder = { ...DEFAULT_SIGNAL_STATE, filterOrder: 4 };
  assert.equal(isSignalStateV2(badFilterOrder), false);
});

test("encodeSignalState/decodeSignalState: round-trips the full state including filter-design fields", () => {
  const state = { ...DEFAULT_SIGNAL_STATE, showFilter: true, filterType: "highpass", filterOrder: "6", filterCutoffHz: "20" };
  const decoded = decodeSignalState(encodeSignalState(state));
  assert.deepEqual(decoded, state);
});
