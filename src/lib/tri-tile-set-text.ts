import type { TriTile, TriTileSet } from "./tiles/tri-tile-model.ts";

/**
 * Line-based text format for a triangular Wang tile set -- `id left right
 * top bottom` (id then the 4 possible edge labels; see tri-tile-model.ts's
 * own doc comment for why a tile always defines all 4 even though a given
 * placement only uses 3), mirroring tile-set-text.ts's square-lattice
 * format exactly.
 */
export function parseTriTileSetText(text: string): TriTileSet {
  const tiles: TriTile[] = [];
  const seenIds = new Set<string>();
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === "" || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    if (parts.length !== 5) {
      throw new Error(`Line ${i + 1}: expected "id left right top bottom" (5 fields), got ${parts.length}: "${line}"`);
    }
    const [id, left, right, top, bottom] = parts as [string, string, string, string, string];
    if (seenIds.has(id)) throw new Error(`Line ${i + 1}: duplicate tile id "${id}"`);
    seenIds.add(id);
    tiles.push({ id, edges: { left, right, top, bottom } });
  }
  if (tiles.length === 0) throw new Error("No tiles defined -- add at least one line: id left right top bottom");
  return { tiles };
}

export function triTileSetToText(tileSet: TriTileSet): string {
  return tileSet.tiles.map((t) => [t.id, t.edges.left, t.edges.right, t.edges.top, t.edges.bottom].join(" ")).join("\n");
}

/**
 * Two tiles compatible left<->right (A.right="1" matches B.left="1"; B.right="2"
 * matches A.left="2") but wildcard-compatible on top/bottom, same demo
 * shape as the square/hex lattices' own defaults.
 */
export const DEFAULT_TRI_TILES_TEXT = "A 2 1 x x\nB 1 2 x x";
