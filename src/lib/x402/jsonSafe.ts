// ---------------------------------------------------------------------------
// JSON-safe serialization — converts BigInt to decimal strings recursively
// ---------------------------------------------------------------------------

function bigIntReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  return value;
}

/**
 * Recursively deep-clone and normalize an object for JSON serialization.
 * Converts BigInt → decimal string. Preserves strings, numbers, booleans, null.
 * Does NOT mutate the source object.
 */
export function normalizeForJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, bigIntReplacer)) as T;
}
