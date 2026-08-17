/**
 * Composes a curve's already-computed roots/extrema/discontinuities
 * (issue #50's "generated descriptions" half) into one prose sentence,
 * for use as a canvas's accessible name (`aria-label`) and as
 * agent-readable context via the existing generic `${prefix}_get_cell`
 * WebMCP tool (see `use-cell-graph-tools.ts`) -- no bespoke tool needed,
 * this is just another cell's value.
 */
import type { CurveExtrema } from "./curve-extrema.ts";
import type { Viewport } from "./viewport.ts";

interface DiscontinuityGap {
  before: { x: number; y: number };
  after: { x: number; y: number };
}

/** Caps how many events get spelled out in the sentence -- a wiggly curve can have dozens of roots/extrema, and an aria-label that long stops being useful to a screen reader. */
const MAX_EVENTS = 6;

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * A vertical-asymptote-like gap: both sides diverge toward +/-Infinity in
 * the SAMPLED data (clipped to the sampler's own y-range, so a real value
 * of e.g. 1e6 reads as "large" here) rather than a gap that's simply
 * where the curve exits the viewport's y-range with a finite value on
 * both sides (a domain edge, not a singularity).
 */
function isAsymptoteLike(gap: DiscontinuityGap, viewport: Viewport): boolean {
  const range = viewport.yMax - viewport.yMin;
  const margin = range * 0.02;
  const nearEdge = (y: number) => y <= viewport.yMin + margin || y >= viewport.yMax - margin;
  return nearEdge(gap.before.y) || nearEdge(gap.after.y);
}

/**
 * `label` names the curve in the sentence (e.g. "f(x) = sin(x)"); pass
 * `null` for a single-curve context where the label would be redundant.
 */
export function describeCurve(label: string | null, viewport: Viewport, roots: { x: number; y: number }[], extrema: CurveExtrema, discontinuities: DiscontinuityGap[]): string {
  type Event = { x: number; text: string };
  const events: Event[] = [];
  for (const r of roots) events.push({ x: r.x, text: `root at x=${fmt(r.x)}` });
  for (const m of extrema.maxima) events.push({ x: m.x, text: `local max near x=${fmt(m.x)} (y=${fmt(m.y)})` });
  for (const m of extrema.minima) events.push({ x: m.x, text: `local min near x=${fmt(m.x)} (y=${fmt(m.y)})` });
  for (const gap of discontinuities) {
    const x = (gap.before.x + gap.after.x) / 2;
    events.push({ x, text: isAsymptoteLike(gap, viewport) ? `vertical asymptote near x=${fmt(x)}` : `gap near x=${fmt(x)}` });
  }
  events.sort((a, b) => a.x - b.x);

  const prefix = label ? `${label}: ` : "";
  if (events.length === 0) return `${prefix}no roots, extrema, or discontinuities found in the current view.`;

  const shown = events.slice(0, MAX_EVENTS);
  const extra = events.length - shown.length;
  const body = shown.map((e) => e.text).join(", ");
  const tail = extra > 0 ? `, and ${extra} more` : "";
  return `${prefix}${body}${tail}.`;
}
