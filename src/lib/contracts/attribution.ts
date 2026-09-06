/**
 * Celo transaction attribution helper.
 *
 * Celo Builders assign each project an attribution code that is encoded as an
 * ERC-8021 data suffix. The official SDK owns the wire format and validation;
 * this module only loads the configured code and appends the resulting suffix
 * to calldata when attribution is enabled.
 *
 * When NEXT_PUBLIC_CELO_ATTRIBUTION_TAG is unset (or invalid), every helper
 * degrades to a safe no-op and transactions are sent without attribution.
 */

import { fromDataSuffix, toDataSuffix } from "@celo/attribution-tags";
import { concat } from "viem";

const RAW_TAG = process.env.NEXT_PUBLIC_CELO_ATTRIBUTION_TAG;

/**
 * Normalize an attribution code into an ERC-8021 data suffix.
 *
 * The SDK deliberately validates text codes. In particular, raw hex is not
 * accepted as a fallback because doing so would bypass ERC-8021 validation.
 * The round-trip check also ensures that the value we return is decodable as a
 * valid Schema 0 attribution suffix.
 */
export function normalizeTag(raw: string | undefined): `0x${string}` | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  try {
    const suffix = toDataSuffix(trimmed);
    const decoded = fromDataSuffix(suffix);

    if (
      !decoded ||
      decoded.schemaId !== 0 ||
      decoded.codes.length !== 1 ||
      decoded.codes[0] !== trimmed
    ) {
      return undefined;
    }

    return suffix;
  } catch {
    // Invalid SDK input must never produce an attribution suffix.
    return undefined;
  }
}

const NORMALIZED_TAG = normalizeTag(RAW_TAG);

/** The configured attribution code as an encoded ERC-8021 suffix. */
export function getAttributionTag(): `0x${string}` | undefined {
  return NORMALIZED_TAG;
}

/**
 * Data suffix for viem/wagmi write calls (`dataSuffix` parameter).
 * Returns undefined when no valid code is configured so writes proceed
 * without attribution.
 */
export function getAttributionDataSuffix(): `0x${string}` | undefined {
  return NORMALIZED_TAG;
}

/**
 * Append the already-encoded attribution suffix to calldata.
 * Returns the calldata unchanged when no valid code is configured.
 */
export function appendAttributionTag(calldata: `0x${string}`): `0x${string}` {
  const tag = NORMALIZED_TAG;
  if (!tag) return calldata;
  return concat([calldata, tag]);
}

export function isAttributionEnabled(): boolean {
  return Boolean(NORMALIZED_TAG);
}
