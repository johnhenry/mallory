import type { HexTile, HexTileSet } from "./tiles/hex-tile-model.ts";

/**
 * Line-based text format for a hex Wang tile set -- `id e0 e1 e2 e3 e4 e5`
 * (id then the six edge labels in mallory-math's HEX_AXIAL_DIRECTIONS
 * order: E, NE, NW, W, SW, SE), mirroring tile-set-text.ts's square-lattice
 * format exactly (same blank-line/`#`-comment handling, same duplicate-id
 * check).
 */
export function parseHexTileSetText(text: string): HexTileSet {
  const tiles: HexTile[] = [];
  const seenIds = new Set<string>();
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === "" || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    if (parts.length !== 7) {
      throw new Error(`Line ${i + 1}: expected "id e0 e1 e2 e3 e4 e5" (7 fields), got ${parts.length}: "${line}"`);
    }
    const [id, e0, e1, e2, e3, e4, e5] = parts as [string, string, string, string, string, string, string];
    if (seenIds.has(id)) throw new Error(`Line ${i + 1}: duplicate tile id "${id}"`);
    seenIds.add(id);
    tiles.push({ id, edges: { 0: e0, 1: e1, 2: e2, 3: e3, 4: e4, 5: e5 } });
  }
  if (tiles.length === 0) throw new Error("No tiles defined -- add at least one line: id e0 e1 e2 e3 e4 e5");
  return { tiles };
}

export function hexTileSetToText(tileSet: HexTileSet): string {
  return tileSet.tiles.map((t) => [t.id, t.edges[0], t.edges[1], t.edges[2], t.edges[3], t.edges[4], t.edges[5]].join(" ")).join("\n");
}

/**
 * Two tiles compatible along direction 0 (E) <-> direction 3 (W, its
 * opposite) in either order -- A.edges[0]="1" matches B.edges[3]="1", and
 * B.edges[0]="2" matches A.edges[3]="2" -- but wildcard-compatible on
 * every other edge (all "x"), same demo shape as the square lattice's own
 * default (real edge-matching visible immediately, no dead ends).
 */
export const DEFAULT_HEX_TILES_TEXT = "A 1 x x 2 x x\nB 2 x x 1 x x";
