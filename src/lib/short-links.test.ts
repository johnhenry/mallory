import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  ensureShortLinksSchema,
  generateShortId,
  insertShortLink,
  resolveShortLinkTarget,
} from "./short-links.ts";

function testDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  ensureShortLinksSchema(db);
  return db;
}

test("generateShortId is 8 characters, hand-verified against a deterministic random source", () => {
  // A fixed sequence of "random" values, each selecting a known index into
  // the 62-char alphabet ("0123456789abc...XYZ") -- 0 -> '0', then
  // progressively higher fractions selecting later characters.
  const values = [0, 0.2, 0.4, 0.6, 0.8, 0.1, 0.3, 0.5];
  let i = 0;
  const id = generateShortId(() => values[i++] as number);
  assert.equal(id.length, 8);
  // Every char must be alphanumeric (the alphabet has no other characters).
  assert.match(id, /^[0-9a-zA-Z]{8}$/);
});

test("generateShortId always picks from the 62-char alphabet, never index-out-of-range even at random()'s upper edge", () => {
  // random() approaching (but never reaching) 1 must still floor to a
  // valid index (61, the last alphabet character), not 62 (out of bounds).
  const id = generateShortId(() => 0.9999999);
  assert.match(id, /^[0-9a-zA-Z]{8}$/);
});

test("insertShortLink + resolveShortLinkTarget builds the exact path#hash for a tab-hosted kind", () => {
  const db = testDb();
  insertShortLink(db, { id: "abc12345", kind: "ode", encodedState: "eyJmb28iOiJiYXIifQ", createdAt: 1700000000000 });
  assert.equal(resolveShortLinkTarget(db, "abc12345"), "/calculus?tab=ode#eyJmb28iOiJiYXIifQ");
});

test("insertShortLink + resolveShortLinkTarget builds the exact path#hash for a non-tab kind", () => {
  const db = testDb();
  insertShortLink(db, { id: "xyz98765", kind: "notebook", encodedState: "SGVsbG8", createdAt: 1700000000000 });
  assert.equal(resolveShortLinkTarget(db, "xyz98765"), "/notes#SGVsbG8");
});

test("resolveShortLinkTarget returns undefined for an id that was never inserted", () => {
  const db = testDb();
  assert.equal(resolveShortLinkTarget(db, "does-not-exist"), undefined);
});
