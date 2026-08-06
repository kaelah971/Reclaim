// ---------------------------------------------------------------------------
// Canonical JSON serializer — deterministic, address-normalizing, safe
//
// Produces identical JSON for semantically identical inputs:
//  - Object keys sorted alphabetically
//  - EVM addresses (fields ending in 'Address', 'client', 'worker', etc.)
//    normalised to lowercase
//  - bigint serialised as base-10 strings
//  - undefined values omitted from objects
//  - null preserved
//  - No functions, symbols, NaN, Infinity, Map, Set, etc.
//  - Bounded nesting depth
// ---------------------------------------------------------------------------

export function normalizeAddress(addr: string): string {
  return addr.toLowerCase();
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_NESTING_DEPTH = 50;

const ADDRESS_FIELD_PATTERNS: readonly (readonly [RegExp, string])[] = [
  // Exact field name matches (case-insensitive)
  [/^client$/i, "client"],
  [/^worker$/i, "worker"],
  [/^token$/i, "token"],
  // Fields ending in "Address" (camelCase)
  [/Address$/i, "addressSuffix"],
];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isEVMHexAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

function shouldNormalizeAddress(fieldName: string): boolean {
  for (const [pattern] of ADDRESS_FIELD_PATTERNS) {
    if (pattern.test(fieldName)) {
      return true;
    }
  }
  return false;
}

function maybeNormalizeFieldValue(
  fieldName: string,
  value: string,
): string {
  if (
    isEVMHexAddress(value) &&
    shouldNormalizeAddress(fieldName)
  ) {
    return value.toLowerCase();
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

// ---------------------------------------------------------------------------
// Core canonicalisation
// ---------------------------------------------------------------------------

function canonicalizeValue(value: unknown, depth: number): string {
  if (depth > MAX_NESTING_DEPTH) {
    throw new Error(
      `Canonicalization exceeded maximum nesting depth of ${MAX_NESTING_DEPTH}`,
    );
  }

  // null
  if (value === null) return "null";

  // undefined
  if (value === undefined) return "null";

  // boolean
  if (typeof value === "boolean") return value ? "true" : "false";

  // number
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(
        `Cannot canonicalise non-finite number: ${value}`,
      );
    }
    // Integer or decimal
    if (Number.isInteger(value)) {
      return String(value);
    }
    // Use toString which matches JSON.stringify for simple decimals
    return String(value);
  }

  // bigint
  if (typeof value === "bigint") {
    return `"${value.toString(10)}"`;
  }

  // string
  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  // symbol
  if (typeof value === "symbol") {
    throw new Error("Cannot canonicalise Symbol");
  }

  // function
  if (typeof value === "function") {
    throw new Error("Cannot canonicalise Function");
  }

  // Map, Set, etc.
  if (value instanceof Map) {
    throw new Error("Cannot canonicalise Map — use a plain object");
  }

  if (value instanceof Set) {
    throw new Error("Cannot canonicalise Set — use an array");
  }

  if (value instanceof Date) {
    throw new Error("Cannot canonicalise Date — use epoch timestamp");
  }

  if (value instanceof RegExp) {
    throw new Error("Cannot canonicalise RegExp");
  }

  // array
  if (Array.isArray(value)) {
    const elements = value.map((v) => canonicalizeValue(v, depth + 1));
    return `[${elements.join(",")}]`;
  }

  // object (plain)
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    const pairs: string[] = [];

    for (const key of keys) {
      const val = (value as Record<string, unknown>)[key];
      // Omit undefined values
      if (val === undefined) continue;

      const serializedKey = JSON.stringify(key);
      let serializedValue: string;

      // Address normalization for string values
      if (typeof val === "string" && shouldNormalizeAddress(key)) {
        serializedValue = JSON.stringify(
          maybeNormalizeFieldValue(key, val),
        );
      } else {
        serializedValue = canonicalizeValue(val, depth + 1);
      }

      pairs.push(`${serializedKey}:${serializedValue}`);
    }

    return `{${pairs.join(",")}}`;
  }

  // Unknown type
  throw new Error(
    `Cannot canonicalise value of type ${typeof value}: ${String(value)}`,
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Produces a deterministic JSON representation of any valid JSON-like value.
 *
 * Properties:
 *  - Object keys sorted alphabetically
 *  - EVM addresses in address-named fields normalised to lowercase
 *  - bigint serialised as base-10 decimal strings
 *  - undefined omitted from objects
 *  - null preserved
 *
 * @throws If the value contains non-serialisable types (Symbol, Function,
 *         Map, Set, NaN, Infinity, Date, RegExp).
 * @throws If the nesting depth exceeds {@link MAX_NESTING_DEPTH}.
 */
export function canonicalize(value: unknown): string {
  return canonicalizeValue(value, 0);
}
