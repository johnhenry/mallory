/**
 * Custom initial-state editor support (issue #260 item 1): a compact
 * '0'/'1' bitstring representation for a user-painted 1D row or 2D grid,
 * matching this app's own base64url hash-state convention -- `CaState`'s
 * whole JSON blob is already base64url-encoded (see ca-state.ts), so the
 * bitstring itself just needs to be a plain JSON-safe string, one character
 * per cell, row-major for 2D. No extra bit-packing layer is worth the
 * complexity on top of that outer encoding.
 *
 * Deliberately dimension-agnostic: the 1D editor is just this module's 2D
 * grid with `height = 1`, so `elementary.ts` and `life-like.ts` both reuse
 * the same encode/decode/edit primitives rather than each rolling their own.
 */

export type Cell = 0 | 1;

/** Encodes a flat cell array as a '0'/'1' bitstring, one character per cell. */
export function encodeBits(cells: readonly Cell[]): string {
  return cells.map((c) => (c === 1 ? "1" : "0")).join("");
}

/**
 * Decodes a bitstring into exactly `length` cells: any character other than
 * '1' (including "missing", when `bits` is shorter than `length`) reads as
 * 0/dead, and any characters past `length` are ignored -- so an editor whose
 * width/height changed after painting doesn't need an explicit resize step,
 * it just re-decodes the same stored bitstring against the new length.
 */
export function decodeBits(bits: string, length: number): Cell[] {
  if (!Number.isInteger(length) || length < 0) throw new Error("length must be a non-negative integer.");
  const cells: Cell[] = new Array(length);
  for (let i = 0; i < length; i++) cells[i] = bits[i] === "1" ? 1 : 0;
  return cells;
}

/** 1D convenience: decode a bitstring into a single row of `width` cells. */
export function decodeCustomRow(bits: string, width: number): Cell[] {
  return decodeBits(bits, width);
}

/** 2D convenience: decode a bitstring (row-major) into a `height` x `width` grid. */
export function decodeCustomGrid(bits: string, width: number, height: number): Cell[][] {
  const flat = decodeBits(bits, width * height);
  const grid: Cell[][] = [];
  for (let row = 0; row < height; row++) grid.push(flat.slice(row * width, (row + 1) * width));
  return grid;
}

/** Encodes a 2D grid (row-major) back into a flat bitstring. */
export function encodeCustomGrid(grid: readonly (readonly Cell[])[]): string {
  const flat: Cell[] = [];
  for (const row of grid) for (const cell of row) flat.push(cell);
  return encodeBits(flat);
}

/** Sets a single cell (by flat row-major index) in a bitstring of `length` cells, returning the updated bitstring. Out-of-range indices are a no-op (still round-trips `bits` through decode/encode at `length`). Used by the editor's click/paint handlers. */
export function setBit(bits: string, length: number, index: number, value: Cell): string {
  const cells = decodeBits(bits, length);
  if (index >= 0 && index < length) cells[index] = value;
  return encodeBits(cells);
}

/** Flips a single cell (by flat row-major index) in a bitstring of `length` cells. */
export function toggleBit(bits: string, length: number, index: number): string {
  const cells = decodeBits(bits, length);
  if (index >= 0 && index < length) cells[index] = cells[index] === 1 ? 0 : 1;
  return encodeBits(cells);
}

/**
 * Maps a pixel coordinate (relative to a grid canvas's top-left corner) to a
 * flat row-major cell index, or `null` if outside the `width` x `height`
 * grid -- shared by the 1D (`height = 1`) and 2D editors' pointer handlers.
 */
export function pixelToCellIndex(x: number, y: number, cellSize: number, width: number, height: number): number | null {
  if (cellSize <= 0) return null;
  const col = Math.floor(x / cellSize);
  const row = Math.floor(y / cellSize);
  if (col < 0 || col >= width || row < 0 || row >= height) return null;
  return row * width + col;
}

/** An all-dead bitstring of `length` cells -- the "Clear" editor action, and (via the empty string, which `decodeBits` already pads with 0s) `CaState`'s own default `customGrid1d`/`customGrid2d`. */
export function blankBits(length: number): string {
  return "0".repeat(Math.max(0, length));
}
