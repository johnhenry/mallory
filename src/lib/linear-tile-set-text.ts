import type { LinearTile, LinearTileSet } from "./tiles/linear-tile-model.ts";

/**
 * Line-based text format for a linear (1D) Wang tile set -- `id left right`
 * (id then the two edge labels), mirroring hex-tile-set-text.ts's format
 * exactly (same blank-line/`#`-comment handling, same duplicate-id check).
 */
export function parseLinearTileSetText(text: string): LinearTileSet {
  const tiles: LinearTile[] = [];
  const seenIds = new Set<string>();
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === "" || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    if (parts.length !== 3) {
      throw new Error(`Line ${i + 1}: expected "id left right" (3 fields), got ${parts.length}: "${line}"`);
    }
    const [id, left, right] = parts as [string, string, string];
    if (seenIds.has(id)) throw new Error(`Line ${i + 1}: duplicate tile id "${id}"`);
    seenIds.add(id);
    tiles.push({ id, left, right });
  }
  if (tiles.length === 0) throw new Error("No tiles defined -- add at least one line: id left right");
  return { tiles };
}

export function linearTileSetToText(tileSet: LinearTileSet): string {
  return tileSet.tiles.map((t) => [t.id, t.left, t.right].join(" ")).join("\n");
}

/**
 * Two tiles that chain in a visible, non-trivial way: A's right ("1")
 * matches B's left ("1"), and B's right ("2") matches A's left ("2") -- so
 * "A B A B ..." is a valid (and periodic) row -- but A's right does NOT
 * match A's left, and B's right does NOT match B's left, so neither tile
 * can repeat itself. Real edge-matching visible immediately, no dead ends,
 * same demo shape as `DEFAULT_HEX_TILES_TEXT`'s own default.
 */
export const DEFAULT_LINEAR_TILES_TEXT = "A 2 1\nB 1 2";
