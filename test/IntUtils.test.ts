import assert from "node:assert/strict";
import { test } from "node:test";
import { IntUtils } from "../src/IntUtils.ts";

test("toWordsTriple: ones and teens", () => {
  assert.equal(IntUtils.toWordsTriple(0), "zero");
  assert.equal(IntUtils.toWordsTriple(7), "seven");
  assert.equal(IntUtils.toWordsTriple(19), "nineteen");
});

test("toWordsTriple: tens with corrected spelling", () => {
  assert.equal(IntUtils.toWordsTriple(20), "twenty");
  assert.equal(IntUtils.toWordsTriple(40), "forty"); // was "fourty" in AS3
  assert.equal(IntUtils.toWordsTriple(90), "ninety"); // was "ninty" in AS3
  assert.equal(IntUtils.toWordsTriple(99), "ninety-nine");
  assert.equal(IntUtils.toWordsTriple(42), "forty-two");
});

test("toWordsTriple: hundreds", () => {
  assert.equal(IntUtils.toWordsTriple(100), "one-hundred");
  assert.equal(IntUtils.toWordsTriple(234), "two-hundred-thirty-four");
  assert.equal(IntUtils.toWordsTriple(905), "nine-hundred-five");
});

test("numberGroupNames", () => {
  assert.equal(IntUtils.numberGroupNames(0), "");
  assert.equal(IntUtils.numberGroupNames(1), "-thousand");
  assert.equal(IntUtils.numberGroupNames(2), "-million");
  assert.equal(IntUtils.numberGroupNames(99), "ZILLION!!!");
});

test("toWords: single group and negatives", () => {
  assert.equal(IntUtils.toWords(7), "seven");
  assert.equal(IntUtils.toWords(-42), "negative forty-two");
});

test("toWords: multi-group grouping", () => {
  assert.equal(IntUtils.toWords(1000), "one-thousand");
  assert.equal(IntUtils.toWords(1000000), "one-million");
  assert.equal(IntUtils.toWords(1234567), "one-million,two-hundred-thirty-four-thousand,five-hundred-sixty-seven");
});

test("toWords: accepts string form for big numbers", () => {
  assert.equal(IntUtils.toWords("2000"), "two-thousand");
});

test("toWordsOrdinal", () => {
  assert.equal(IntUtils.toWordsOrdinal(1), "first");
  assert.equal(IntUtils.toWordsOrdinal(2), "second");
  assert.equal(IntUtils.toWordsOrdinal(21), "twenty-first");
  assert.equal(IntUtils.toWordsOrdinal(23), "twenty-third");
});

test("toWordsOrdinalLazy strips a leading one-", () => {
  assert.equal(IntUtils.toWordsOrdinalLazy(100), "hundredth");
});
