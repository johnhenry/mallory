/**
 * Deterministic edge-label -> stroke color, so a Wang tile's matching
 * constraint is visible at a glance: two edges with the same label (which
 * `tilesCompatible`/`hexTilesCompatible`/`triTilesCompatible` require to be
 * equal for a legal placement) always render in the same color, across
 * every lattice (square/hex/tri/cube) and across reloads. Same hash-based
 * approach as `TilesPanel.tsx`'s own `tileColor`, deliberately a different
 * hash constant (33 vs 31) so a label and a same-named tile id don't
 * coincidentally land on the same hue.
 */
export function edgeLabelColor(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = (hash * 33 + label.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return `hsl(${hue}, 70%, 45%)`;
}
