/**
 * URL-state schema for SignalPanel -- the raw inputs only (see
 * cell-ids.ts's cellIdsSignal); every result cell is purely derived.
 */
export interface SignalStateV1 {
  v: 1;
  exprText: string;
  sampleRate: string;
  duration: string;
}

export interface SignalStateV2 {
  v: 2;
  exprText: string;
  sampleRate: string;
  duration: string;
  nperseg: string;
  noverlap: string;
  /**
   * Issue #31's "findPeaks on the spectrum" extra -- off by default. Optional
   * (not a schema version bump, same convention as GradientDescentStateV1's
   * `useSchedule`/`stepSize`/`gamma`) so an old encoded URL hash from before
   * these fields existed still decodes instead of failing validation and
   * silently resetting the WHOLE state to defaults.
   */
  showPeaks?: boolean;
  minAmplitude?: string;
  minSpacingHz?: string;
  minProminence?: string;
  /**
   * Cross-correlation lag-finder (issue #31's "extras" item) -- optional for
   * the same reason as the peak-finding fields above: an old encoded URL
   * fragment from before this existed should still decode.
   */
  showCorrelation?: boolean;
  exprTextB?: string;
  /**
   * `resamplePoly` demo (issue #31's last "extras" item) -- optional for the
   * same reason as the fields above.
   */
  showResample?: boolean;
  resampleUp?: string;
  resampleDown?: string;
}

export type SignalState = SignalStateV2;

export const DEFAULT_SIGNAL_STATE: SignalState = {
  v: 2,
  exprText: "sin(2*pi*5*t) + 0.5*sin(2*pi*12*t)",
  sampleRate: "64",
  duration: "1",
  nperseg: "16",
  noverlap: "8",
  showPeaks: false,
  minAmplitude: "0",
  minSpacingHz: "0",
  minProminence: "0",
  showCorrelation: false,
  // The same waveform as the default f(t), delayed by 0.05s -- a
  // ready-made demo where the cross-correlation's detected lag should read
  // back close to +0.05s with zero manual tuning.
  exprTextB: "sin(2*pi*5*(t-0.05)) + 0.5*sin(2*pi*12*(t-0.05))",
  showResample: false,
  resampleUp: "1",
  resampleDown: "2",
};

export function encodeSignalState(state: SignalState): string {
  return base64UrlEncode(JSON.stringify(state));
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. Upgrades a v1 payload to v2 with the spectrogram fields defaulted. */
export function decodeSignalState(fragment: string): SignalState | null {
  try {
    const parsed: unknown = JSON.parse(base64UrlDecode(fragment));
    if (isSignalStateV2(parsed)) return parsed;
    if (isSignalStateV1(parsed)) return upgradeV1ToV2(parsed);
    return null;
  } catch {
    return null;
  }
}

function upgradeV1ToV2(v1: SignalStateV1): SignalStateV2 {
  return { ...v1, v: 2, nperseg: DEFAULT_SIGNAL_STATE.nperseg, noverlap: DEFAULT_SIGNAL_STATE.noverlap };
}

function hasV1Fields(v: Record<string, unknown>): boolean {
  const fields = ["exprText", "sampleRate", "duration"] as const;
  return fields.every((f) => typeof v[f] === "string");
}

export function isSignalStateV1(value: unknown): value is SignalStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.v === 1 && hasV1Fields(v);
}

export function isSignalStateV2(value: unknown): value is SignalStateV2 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 2 || !hasV1Fields(v)) return false;
  if (typeof v.nperseg !== "string" || typeof v.noverlap !== "string") return false;
  if (v.showPeaks !== undefined && typeof v.showPeaks !== "boolean") return false;
  if (v.showCorrelation !== undefined && typeof v.showCorrelation !== "boolean") return false;
  if (v.showResample !== undefined && typeof v.showResample !== "boolean") return false;
  const optionalStringFields = ["minAmplitude", "minSpacingHz", "minProminence", "exprTextB", "resampleUp", "resampleDown"] as const;
  return optionalStringFields.every((f) => v[f] === undefined || typeof v[f] === "string");
}

function base64UrlEncode(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
