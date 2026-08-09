/**
 * Celo transaction attribution helper.
 *
 * Celo Builders assign each project an attribution tag that is appended to
 * transaction calldata as a raw data suffix. The suffix is ignored by the
 * EVM during execution, so decoded contract arguments are never affected.
 *
 * No tag is fabricated here: when NEXT_PUBLIC_CELO_ATTRIBUTION_TAG is unset
 * (or malformed) every helper degrades to a safe no-op and transactions are
 * simply sent without attribution.
 */

import { toHex } from "viem";

const RAW_TAG = process.env.NEXT_PUBLIC_CELO_ATTRIBUTION_TAG;

const HEX_TAG_PATTERN = /^0x[0-9a-fA-F]+$/;

/**
 * Normalize a raw attribution tag into `0x`-prefixed hex data.
 *
 * Values that are already valid `0x`-prefixed hex (even length) are preserved
 * (lowercased) and never re-encoded. Any other non-empty value is treated as
 * ASCII/UTF-8 text and encoded byte-by-byte to hex — this is how Celo Builders
 * project tags (e.g. `celo_b7de8bf7e64e`) are expected to be sent. Fails closed
 * (returns undefined) for empty/whitespace input, malformed `0x`-prefixed hex,
 * and odd-length `0x`-prefixed hex.
 */
export function normalizeTag(raw: string | undefined): `0x${string}` | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("0x")) {
    // Already explicitly hex — validate strictly and preserve it.
    if (!HEX_TAG_PATTERN.test(trimmed)) return undefined;
    if (trimmed.length % 2 !== 0) return undefined;
    return trimmed.toLowerCase() as `0x${string}`;
  }
  // Plain text tag (e.g. a Celo Builders project tag) — encode its UTF-8
  // bytes to hex; every byte produces exactly 2 hex chars, so the result
  // is always valid even-length data.
  return toHex(trimmed);
}

const NORMALIZED_TAG = normalizeTag(RAW_TAG);

/** The configured attribution tag as 0x-prefixed hex, or undefined. */
export function getAttributionTag(): `0x${string}` | undefined {
  return NORMALIZED_TAG;
}

/**
 * Data suffix for viem/wagmi write calls (`dataSuffix` parameter).
 * Returns undefined when no valid tag is configured so writes proceed
 * without attribution.
 */
export function getAttributionDataSuffix(): `0x${string}` | undefined {
  return NORMALIZED_TAG;
}

/**
 * Deterministically append the attribution tag to already-encoded calldata.
 * Returns the calldata unchanged when no valid tag is configured.
 */
export function appendAttributionTag(calldata: `0x${string}`): `0x${string}` {
  const tag = NORMALIZED_TAG;
  if (!tag) return calldata;
  return `${calldata}${tag.slice(2)}` as `0x${string}`;
}

export function isAttributionEnabled(): boolean {
  return Boolean(NORMALIZED_TAG);
}
