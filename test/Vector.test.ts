import assert from "node:assert/strict";
import { test } from "node:test";
import { Vector } from "../src/Vector.ts";

test("single-number constructor sets length (Array contract)", () => {
  const v = new Vector<number>(3);
  assert.equal(v.length, 3);
});

test("multi-arg constructor stores elements", () => {
  const v = new Vector(1, 2, 3);
  assert.deepEqual([...v], [1, 2, 3]);
});

test("fromArray copies an iterable", () => {
  const v = Vector.fromArray([4, 5, 6]);
  assert.ok(v instanceof Vector);
  assert.deepEqual([...v], [4, 5, 6]);
});

test("toString honours separators and brackets", () => {
  const v = new Vector(1, 2, 3);
  assert.equal(v.toString(), "[1,2,3]");
  assert.equal(v.toString(";", "(", ")"), "(1;2;3)");
});

test("toXML serialises coordinates", () => {
  const v = new Vector(1, 2);
  assert.equal(v.toXML(), "<vector><coordinate>1</coordinate><coordinate>2</coordinate></vector>");
});

test("getElement / removeElement", () => {
  const v = new Vector(10, 20, 30);
  assert.equal(v.getElement(1), 20);
  assert.equal(v.removeElement(1), 20);
  assert.deepEqual([...v], [10, 30]);
});

test("setElement returns previous value and pads with placeholder", () => {
  const v = new Vector<number | null>(1, 2);
  assert.equal(v.setElement(99, 1), 2);
  assert.equal(v[1], 99);
  // padding: setting index 4 on a length-2 vector fills the gap
  v.setElement(7, 4, 0);
  assert.deepEqual([...v], [1, 99, 0, 0, 7]);
});

test("setElement does NOT infinitely recurse on a falsy slot (bug fix)", () => {
  const v = new Vector<number>(0, 0, 0);
  // In the AS3 original this looped forever; here it just assigns.
  assert.equal(v.setElement(5, 0), 0);
  assert.equal(v[0], 5);
});

test("addElement appends when index is negative", () => {
  const v = new Vector(1, 2);
  assert.equal(v.addElement(3), 3);
  assert.deepEqual([...v], [1, 2, 3]);
});

test("addElement inserts and pads", () => {
  const v = new Vector<number | null>(1, 2);
  v.addElement(9, 4, 0);
  assert.deepEqual([...v], [1, 2, 0, 0, 9]);
});

test("x/y/z/t point accessors return stored zero (bug fix)", () => {
  const v = new Vector(0, 5, 0, 8);
  assert.equal(v.x, 0);
  assert.equal(v.y, 5);
  assert.equal(v.z, 0);
  assert.equal(v.t, 8);
});

test("x/y/z/t default to 0 when absent", () => {
  const v = new Vector(1);
  assert.equal(v.y, 0);
  assert.equal(v.z, 0);
});

test("x/y/z/t setters write through", () => {
  const v = new Vector<number>();
  v.x = 1;
  v.y = 2;
  v.z = 3;
  v.t = 4;
  assert.deepEqual([...v], [1, 2, 3, 4]);
});

test("clone is deep for nested vectors", () => {
  const inner = new Vector(1, 2);
  const outer = new Vector<Vector<number>>(inner);
  const copy = outer.clone();
  (copy[0] as Vector<number>)[0] = 99;
  assert.equal(inner[0], 1, "original inner vector must be untouched");
});

test("clone shallow keeps references", () => {
  const inner = new Vector(1, 2);
  const outer = new Vector<Vector<number>>(inner);
  const copy = outer.clone(false);
  assert.equal(copy[0], inner);
});

test("reversed returns a new reversed vector", () => {
  const v = new Vector(1, 2, 3);
  const r = v.reversed();
  assert.deepEqual([...r], [3, 2, 1]);
  assert.deepEqual([...v], [1, 2, 3], "original unchanged");
});

test("is iterable and array-compatible", () => {
  const v = new Vector(1, 2, 3);
  assert.equal(
    v.reduce((a, b) => a + b, 0),
    6,
  );
  assert.deepEqual(Array.from(v), [1, 2, 3]);
});
