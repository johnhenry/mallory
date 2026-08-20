import assert from "node:assert/strict";
import { test } from "node:test";
import {
  blankBits,
  decodeBits,
  decodeCustomGrid,
  decodeCustomGrid3D,
  decodeCustomRow,
  encodeBits,
  encodeCustomGrid,
  encodeCustomGrid3D,
  pixelToCellIndex,
  replaceBitsSlice,
  setBit,
  toggleBit,
} from "./custom-grid.ts";

test("encodeBits/decodeBits round-trip a flat cell array", () => {
  const cells = [0, 1, 1, 0, 1] as const;
  assert.deepEqual(decodeBits(encodeBits(cells), cells.length), [...cells]);
});

test("decodeBits pads a too-short bitstring with 0s", () => {
  assert.deepEqual(decodeBits("101", 5), [1, 0, 1, 0, 0]);
});

test("decodeBits ignores characters past length (truncates)", () => {
  assert.deepEqual(decodeBits("111111", 3), [1, 1, 1]);
});

test("decodeBits treats any non-'1' character as dead", () => {
  assert.deepEqual(decodeBits("1x1 1", 5), [1, 0, 1, 0, 1]);
});

test("decodeBits rejects a negative or non-integer length", () => {
  assert.throws(() => decodeBits("101", -1));
  assert.throws(() => decodeBits("101", 1.5));
});

test("decodeCustomRow is decodeBits under a 1D name", () => {
  assert.deepEqual(decodeCustomRow("010", 3), [0, 1, 0]);
});

test("decodeCustomGrid decodes row-major into a height x width grid", () => {
  // 2x3 grid (width=3, height=2): rows "110" then "001"
  const grid = decodeCustomGrid("110001", 3, 2);
  assert.deepEqual(grid, [
    [1, 1, 0],
    [0, 0, 1],
  ]);
});

test("encodeCustomGrid/decodeCustomGrid round-trip a 2D grid", () => {
  const grid = [
    [1, 0, 1],
    [0, 1, 0],
    [1, 1, 1],
  ] as const;
  const bits = encodeCustomGrid(grid);
  assert.deepEqual(decodeCustomGrid(bits, 3, 3), grid.map((row) => [...row]));
});

test("blankBits produces an all-dead bitstring of the requested length", () => {
  assert.equal(blankBits(4), "0000");
  assert.deepEqual(decodeBits(blankBits(4), 4), [0, 0, 0, 0]);
});

test("blankBits clamps a negative length to empty", () => {
  assert.equal(blankBits(-3), "");
});

test("setBit sets exactly the targeted cell, leaving the rest unchanged", () => {
  const bits = setBit("0000", 4, 2, 1);
  assert.deepEqual(decodeBits(bits, 4), [0, 0, 1, 0]);
});

test("setBit on an out-of-range index is a no-op (still round-trips at length)", () => {
  assert.equal(setBit("0110", 4, 10, 1), "0110");
  assert.equal(setBit("0110", 4, -1, 1), "0110");
});

test("toggleBit flips a 0 to 1 and a 1 back to 0", () => {
  let bits = "0000";
  bits = toggleBit(bits, 4, 1);
  assert.deepEqual(decodeBits(bits, 4), [0, 1, 0, 0]);
  bits = toggleBit(bits, 4, 1);
  assert.deepEqual(decodeBits(bits, 4), [0, 0, 0, 0]);
});

test("pixelToCellIndex maps a pixel coordinate to a row-major flat index", () => {
  // 4-wide x 3-tall grid, 10px cells: (25, 15) -> col 2, row 1 -> index 1*4+2 = 6
  assert.equal(pixelToCellIndex(25, 15, 10, 4, 3), 6);
});

test("pixelToCellIndex returns null outside the grid bounds", () => {
  assert.equal(pixelToCellIndex(-1, 0, 10, 4, 3), null);
  assert.equal(pixelToCellIndex(0, -1, 10, 4, 3), null);
  assert.equal(pixelToCellIndex(40, 0, 10, 4, 3), null); // col 4 is out of bounds for width 4
  assert.equal(pixelToCellIndex(0, 30, 10, 4, 3), null); // row 3 is out of bounds for height 3
});

test("pixelToCellIndex treats height=1 as a 1D row (only y in [0, cellSize) is valid)", () => {
  assert.equal(pixelToCellIndex(15, 5, 10, 4, 1), 1);
  assert.equal(pixelToCellIndex(15, 15, 10, 4, 1), null);
});

test("pixelToCellIndex returns null for a non-positive cellSize", () => {
  assert.equal(pixelToCellIndex(1, 1, 0, 4, 3), null);
});

test("decodeCustomGrid3D decodes z-major into a depth x height x width volume (issue #389)", () => {
  // 2(w) x 2(h) x 2(d): layer z=0 rows "10","01"; layer z=1 rows "11","00"
  const grid = decodeCustomGrid3D("10011100", 2, 2, 2);
  assert.deepEqual(grid, [
    [
      [1, 0],
      [0, 1],
    ],
    [
      [1, 1],
      [0, 0],
    ],
  ]);
});

test("encodeCustomGrid3D/decodeCustomGrid3D round-trip a 3D volume", () => {
  const grid = [
    [
      [1, 0],
      [0, 1],
    ],
    [
      [1, 1],
      [0, 0],
    ],
  ] as const;
  const bits = encodeCustomGrid3D(grid);
  assert.deepEqual(decodeCustomGrid3D(bits, 2, 2, 2), grid.map((layer) => layer.map((row) => [...row])));
});

test("replaceBitsSlice overwrites exactly the targeted slice, leaving the rest of the bitstring unchanged", () => {
  const bits = "000000"; // 2x3 flat, 3 layers of 2 conceptually
  const updated = replaceBitsSlice(bits, 6, 2, 2, "11");
  assert.equal(updated, "001100");
});

test("replaceBitsSlice pads a too-short sliceBits with 0s (same decodeBits convention as everything else here)", () => {
  const updated = replaceBitsSlice("0000", 4, 0, 4, "1");
  assert.equal(updated, "1000");
});

test("replaceBitsSlice ignores any part of the slice that falls outside the total length", () => {
  const updated = replaceBitsSlice("0000", 4, 2, 4, "1111"); // offset 2 + length 4 runs past index 4
  assert.equal(updated, "0011");
});
