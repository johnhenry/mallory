/**
 * NL query pattern for signal-panel filter-design commands (issue #31's
 * remaining scope: 'NL query patterns ("low-pass at 40 Hz")'). A separate
 * module from `nl-query.ts`, same reasoning as `nl-query-matrix.ts`: the
 * target here is a set of filter-design CELLS (showFilter/filterType/
 * filterCutoffHz), not an expression string, so it doesn't fit
 * `nl-query.ts`'s `PATTERNS` contract (every pattern there resolves to an
 * expression). Only "lowpass"/"highpass" are recognized -- matches
 * `filterType`'s own current constraint: `mallory-signal`'s `butter()`
 * only implements lowpass/highpass in v1 (bandpass/bandstop blocked on
 * johnhenry/mallory-plus#90, see SignalPanel's own filter section).
 */
export interface FilterCommand {
  filterType: "lowpass" | "highpass";
  filterCutoffHz: string;
}

const FILTER_PATTERN = /^(low|high)[\s-]?pass(?:\s+filter)?\s+at\s+(\d+(?:\.\d+)?)\s*hz$/i;

export function resolveFilterCommand(input: string): FilterCommand | null {
  const match = input.trim().match(FILTER_PATTERN);
  if (!match) return null;
  const band = (match[1] as string).toLowerCase();
  return { filterType: band === "low" ? "lowpass" : "highpass", filterCutoffHz: match[2] as string };
}
