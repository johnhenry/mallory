import type { MaskType, PatternType } from "./image-frequency.ts";

/**
 * URL-state schema for ImageFrequencyPanel -- the raw inputs only (see
 * cell-ids.ts's cellIdsImageFrequency). No raw pixel data in the URL: v1
 * only supports built-in patterns (see image-frequency.ts's own doc comment
 * on why file upload is deferred), so the pattern NAME is enough to
 * reproduce the image, same as every other panel's flat-string-cells
 * convention.
 */
export interface ImageFrequencyStateV1 {
  v: 1;
  pattern: PatternType;
  size: string;
  maskType: MaskType;
  radius: string;
  radius2: string;
}

export type ImageFrequencyState = ImageFrequencyStateV1;

export const DEFAULT_IMAGE_FREQUENCY_STATE: ImageFrequencyState = {
  v: 1,
  pattern: "checkerboard",
  size: "64",
  maskType: "lowpass",
  radius: "8",
  radius2: "16",
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

const PATTERN_TYPES: PatternType[] = ["checkerboard", "stripes", "circle", "gradient"];
const MASK_TYPES: MaskType[] = ["lowpass", "highpass", "bandpass", "none"];

export function isImageFrequencyStateV1(value: unknown): value is ImageFrequencyStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 1) return false;
  if (!PATTERN_TYPES.includes(v.pattern as PatternType)) return false;
  if (!MASK_TYPES.includes(v.maskType as MaskType)) return false;
  const fields = ["size", "radius", "radius2"] as const;
  return fields.every((f) => typeof v[f] === "string");
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
