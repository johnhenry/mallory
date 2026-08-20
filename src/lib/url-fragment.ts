/**
 * Shared URL-fragment transport for every panel's state codec (#320 step
 * 2, inspired by ha.mr's client-side-compression architecture -- though
 * not its algorithm: ha.mr's Huffman dictionaries compress URL *structure*
 * (domains/TLDs), while this app's length problem is entirely the state
 * payload, which is ordinary repetitive JSON and deflates well).
 *
 * Before this, all 29 `*-state.ts` codecs carried a private copy of the
 * same `base64UrlEncode(JSON.stringify(state))` transport -- which not
 * only didn't compress, it EXPANDED the payload ~33% (base64 over raw
 * JSON). Fragments are now `z:` + base64url(deflate(JSON)) -- typically
 * 3-6x shorter for real states, which shrinks every shareable URL, every
 * gallery reopen href, every stored short-link target, and makes QR codes
 * viable.
 *
 * Backward compatible by construction: legacy fragments are pure base64url
 * (alphabet `A-Za-z0-9_-`), which can never contain `:`, so the `z:`
 * prefix is an unambiguous version marker. `decodeStateFragment` tries the
 * marker first and falls back to the legacy plain-JSON path, so every URL
 * ever shared keeps working.
 *
 * Throws on garbage (mirroring `JSON.parse`) rather than returning null --
 * every codec call site already wraps its decode in try/catch and applies
 * its own shape validation to the parsed value.
 */
import { deflateSync, inflateSync, strFromU8, strToU8 } from "fflate";

const COMPRESSED_PREFIX = "z:";

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  // Chunked fromCharCode -- a single spread/apply over a large state's
  // bytes can overflow the engine's argument-count limit.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(input: string): Uint8Array {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Legacy transport (pre-compression): base64url over UTF-8 JSON text -- byte-for-byte the same decode the codecs' old private helpers used (TextEncoder on the way in, TextDecoder on the way out). */
function legacyBase64UrlDecode(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeStateFragment(state: unknown): string {
  return COMPRESSED_PREFIX + bytesToBase64Url(deflateSync(strToU8(JSON.stringify(state))));
}

export function decodeStateFragment(fragment: string): unknown {
  if (fragment.startsWith(COMPRESSED_PREFIX)) {
    return JSON.parse(strFromU8(inflateSync(base64UrlToBytes(fragment.slice(COMPRESSED_PREFIX.length)))));
  }
  return JSON.parse(legacyBase64UrlDecode(fragment));
}
