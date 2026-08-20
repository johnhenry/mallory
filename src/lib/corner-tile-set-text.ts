import type { CornerTile, CornerTileSet } from "./tiles/corner-tile-model.ts";

/**
 * Line-based text format for a corner Wang tile set (#394) -- `id NE SE SW
 * NW` (id then the four corner labels, clockwise from northeast),
 * mirroring tile-set-text.ts's square-lattice format exactly (same
 * blank-line/`#`-comment handling, same duplicate-id check).
 */
export function parseCornerTileSetText(text: string): CornerTileSet {
  const tiles: CornerTile[] = [];
  const seenIds = new Set<string>();
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === "" || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    if (parts.length !== 5) {
      throw new Error(`Line ${i + 1}: expected "id NE SE SW NW" (5 fields), got ${parts.length}: "${line}"`);
    }
    const [id, ne, se, sw, nw] = parts as [string, string, string, string, string];
    if (seenIds.has(id)) throw new Error(`Line ${i + 1}: duplicate tile id "${id}"`);
    seenIds.add(id);
    tiles.push({ id, corners: { NE: ne, SE: se, SW: sw, NW: nw } });
  }
  if (tiles.length === 0) throw new Error("No tiles defined -- add at least one line: id NE SE SW NW");
  return { tiles };
}

export function cornerTileSetToText(tileSet: CornerTileSet): string {
  return tileSet.tiles.map((t) => [t.id, t.corners.NE, t.corners.SE, t.corners.SW, t.corners.NW].join(" ")).join("\n");
}

/**
 * A 2x2 block of self-consistent corner tiles (one shared color per
 * interior vertex, same construction as corner-tile-model.test.ts's own
 * hand-verified fixture) -- shows real corner-matching behavior on load,
 * unlike a single-tile or wildcard-only demo which wouldn't visibly
 * constrain anything.
 */
export const DEFAULT_CORNER_TILES_TEXT = "A 2 5 4 1\nB 3 6 5 2\nC 5 8 7 4\nD 6 9 8 5";
