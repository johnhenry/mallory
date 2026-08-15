import type { MaskType, PatternType } from "./image-frequency.ts";

/**
 * URL-state schema for ImageFrequencyPanel -- the raw inputs only (see
 * cell-ids.ts's cellIdsImageFrequency). No raw pixel data in the URL, even
 * for `pattern: "upload"`: an uploaded image can't be reproduced from a
 * URL fragment (arbitrary size, no reasonable length cap), so the
 * uploaded grid lives in an auxiliary, non-persisted cell instead
 * (`ImageFrequencyPanel.tsx`'s `useImageFrequencyGraph`) -- mirroring
 * `DataImportPanel`'s "this session isn't the shareable artifact"
 * philosophy. A decoded `pattern: "upload"` hash is structurally valid but
 * shows the upload prompt again on load, same as CSV import's `text`
 * isn't restored either.
 */
export interface ImageFrequencyStateV1 {
  v: 1;
  pattern: PatternType;
  size: string;
  maskType: MaskType;
  radius: string;
  radius2: string;
  /**
   * Directional-wedge mask params (issue #32's remaining scope) -- optional
   * (not a schema version bump, same convention as GradientDescentStateV1's
   * `useSchedule`/`stepSize`/`gamma`) so an old encoded URL hash from
   * before these fields existed still decodes instead of failing
   * validation and silently resetting the WHOLE state to defaults.
   */
  wedgeAngle?: string;
  wedgeWidth?: string;
}

export type ImageFrequencyState = ImageFrequencyStateV1;

export const DEFAULT_IMAGE_FREQUENCY_STATE: ImageFrequencyState = {
  v: 1,
  pattern: "checkerboard",
  size: "64",
  maskType: "lowpass",
  radius: "8",
  radius2: "16",
  wedgeAngle: "0",
  wedgeWidth: "30",
};

export function encodeImageFrequencyState(state: ImageFrequencyState): string {
  return base64UrlEncode(JSON.stringify(state));
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. */
export function decodeImageFrequencyState(fragment: string): ImageFrequencyState | null {
  try {
    const parsed: unknown = JSON.parse(base64UrlDecode(fragment));
    return isImageFrequencyStateV1(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const PATTERN_TYPES: PatternType[] = ["checkerboard", "stripes", "circle", "gradient", "moire", "upload"];
const MASK_TYPES: MaskType[] = ["lowpass", "highpass", "bandpass", "notch", "wedge", "none", "freehand"];

export function isImageFrequencyStateV1(value: unknown): value is ImageFrequencyStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 1) return false;
  if (!PATTERN_TYPES.includes(v.pattern as PatternType)) return false;
  if (!MASK_TYPES.includes(v.maskType as MaskType)) return false;
  const fields = ["size", "radius", "radius2"] as const;
  if (!fields.every((f) => typeof v[f] === "string")) return false;
  const optionalFields = ["wedgeAngle", "wedgeWidth"] as const;
  return optionalFields.every((f) => v[f] === undefined || typeof v[f] === "string");
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
