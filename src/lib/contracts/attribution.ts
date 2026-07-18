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

const RAW_TAG = process.env.NEXT_PUBLIC_CELO_ATTRIBUTION_TAG;

const HEX_TAG_PATTERN = /^0x[0-9a-fA-F]+$/;

function normalizeTag(raw: string | undefined): `0x${string}` | undefined {
  if (!raw) return undefined;
  const candidate = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!HEX_TAG_PATTERN.test(candidate)) return undefined;
  if (candidate.length % 2 !== 0) return undefined;
  return candidate.toLowerCase() as `0x${string}`;
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
