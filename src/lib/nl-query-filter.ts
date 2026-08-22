/**
 * NL query pattern for signal-panel filter-design commands (issue #31's
 * remaining scope: 'NL query patterns ("low-pass at 40 Hz")'). A separate
 * module from `nl-query.ts`, same reasoning as `nl-query-matrix.ts`: the
 * target here is a set of filter-design CELLS (showFilter/filterType/
 * filterCutoffHz[High]), not an expression string, so it doesn't fit
 * `nl-query.ts`'s `PATTERNS` contract (every pattern there resolves to an
 * expression).
 *
 * Bandpass/bandstop phrasings ("band-pass between 200 and 800 Hz")
 * shipped alongside `mallory-signal`'s own bandpass/bandstop support
 * (johnhenry/math-plus#90) -- previously unsupported here too, tracked
 * by the same upstream issue.
 */
export type FilterCommand =
  | { filterType: "lowpass" | "highpass"; filterCutoffHz: string }
  | { filterType: "bandpass" | "bandstop"; filterCutoffHz: string; filterCutoffHzHigh: string };

const LOW_HIGH_PATTERN = /^(low|high)[\s-]?pass(?:\s+filter)?\s+at\s+(\d+(?:\.\d+)?)\s*hz$/i;
const BAND_PATTERN = /^band[\s-]?(pass|stop)(?:\s+filter)?\s+(?:between|from)\s+(\d+(?:\.\d+)?)\s*(?:hz)?\s+(?:and|to)\s+(\d+(?:\.\d+)?)\s*hz$/i;

export function resolveFilterCommand(input: string): FilterCommand | null {
  const trimmed = input.trim();

  const lowHighMatch = trimmed.match(LOW_HIGH_PATTERN);
  if (lowHighMatch) {
    const band = (lowHighMatch[1] as string).toLowerCase();
    return { filterType: band === "low" ? "lowpass" : "highpass", filterCutoffHz: lowHighMatch[2] as string };
  }

  const bandMatch = trimmed.match(BAND_PATTERN);
  if (bandMatch) {
    const kind = (bandMatch[1] as string).toLowerCase();
    return {
      filterType: kind === "pass" ? "bandpass" : "bandstop",
      filterCutoffHz: bandMatch[2] as string,
      filterCutoffHzHigh: bandMatch[3] as string,
    };
  }

  return null;
}
