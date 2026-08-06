// ---------------------------------------------------------------------------
// Canonical JSON serializer — comprehensive test suite
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { canonicalize, normalizeAddress } from "../canonicalize";

describe("normalizeAddress", () => {
  it("lowercases uppercase hex address", () => {
    expect(normalizeAddress("0xABCDEF1234567890ABCDEF1234567890ABCDEF12")).toBe(
      "0xabcdef1234567890abcdef1234567890abcdef12",
    );
  });

  it("preserves already lowercase hex address", () => {
    expect(normalizeAddress("0xabcdef1234567890abcdef1234567890abcdef12")).toBe(
      "0xabcdef1234567890abcdef1234567890abcdef12",
    );
  });

  it("normalizes mixed-case hex address", () => {
    expect(normalizeAddress("0xAbCdEf1234567890aBcDeF1234567890AbCdEf12")).toBe(
      "0xabcdef1234567890abcdef1234567890abcdef12",
    );
  });

  it("returns empty string unchanged", () => {
    expect(normalizeAddress("")).toBe("");
  });

  it("returns non-hex string unchanged (lowercased)", () => {
    expect(normalizeAddress("not-an-address")).toBe("not-an-address");
  });
});

describe("canonicalize — primitives", () => {
  it("canonicalizes a string", () => {
    expect(canonicalize("hello")).toBe('"hello"');
  });

  it("canonicalizes a number (integer)", () => {
    expect(canonicalize(42)).toBe("42");
  });

  it("canonicalizes a negative number", () => {
    expect(canonicalize(-1)).toBe("-1");
  });

  it("canonicalizes boolean true", () => {
    expect(canonicalize(true)).toBe("true");
  });

  it("canonicalizes boolean false", () => {
    expect(canonicalize(false)).toBe("false");
  });

  it("canonicalizes null", () => {
    expect(canonicalize(null)).toBe("null");
  });

  it("canonicalizes bigint as decimal string", () => {
    expect(canonicalize(12345678901234567890n)).toBe('"12345678901234567890"');
  });

  it("canonicalizes zero bigint", () => {
    expect(canonicalize(0n)).toBe('"0"');
  });

  it("canonicalizes negative bigint", () => {
    expect(canonicalize(-1n)).toBe('"-1"');
  });
});

describe("canonicalize — arrays", () => {
  it("canonicalizes an empty array", () => {
    expect(canonicalize([])).toBe("[]");
  });

  it("canonicalizes a homogeneous array", () => {
    expect(canonicalize([1, 2, 3])).toBe("[1,2,3]");
  });

  it("preserves array element order deterministically", () => {
    expect(canonicalize(["b", "a", "c"])).toBe('["b","a","c"]');
  });

  it("canonicalizes nested arrays", () => {
    expect(canonicalize([[1, 2], [3]])).toBe("[[1,2],[3]]");
  });
});

describe("canonicalize — objects", () => {
  it("canonicalizes an empty object", () => {
    expect(canonicalize({})).toBe("{}");
  });

  it("sorts object keys alphabetically", () => {
    const obj = { zebra: 1, apple: 2, banana: 3 };
    const result = canonicalize(obj);
    // "apple" sorts before "banana" sorts before "zebra"
    expect(result).toBe('{"apple":2,"banana":3,"zebra":1}');
  });

  it("preserves key ordering deterministically — repeated calls produce same output", () => {
    const obj = { c: 3, a: 1, b: 2 };
    const result1 = canonicalize(obj);
    const result2 = canonicalize(obj);
    expect(result1).toBe(result2);
    expect(result1).toBe('{"a":1,"b":2,"c":3}');
  });

  it("canonicalizes nested objects", () => {
    const obj = { b: { y: 2, x: 1 }, a: 3 };
    expect(canonicalize(obj)).toBe('{"a":3,"b":{"x":1,"y":2}}');
  });

  it("canonicalizes objects with null values", () => {
    const obj = { a: null, b: "value" };
    expect(canonicalize(obj)).toBe('{"a":null,"b":"value"}');
  });
});

describe("canonicalize — undefined handling", () => {
  it("omits undefined values from objects", () => {
    const obj = { a: 1, b: undefined, c: 3 };
    expect(canonicalize(obj)).toBe('{"a":1,"c":3}');
  });

  it("returns null for undefined primitive", () => {
    expect(canonicalize(undefined)).toBe("null");
  });
});

describe("canonicalize — address normalization", () => {
  it("lowercases field named 'client'", () => {
    const obj = { client: "0xABCDEF1234567890ABCDEF1234567890ABCDEF12" };
    expect(canonicalize(obj)).toBe(
      '{"client":"0xabcdef1234567890abcdef1234567890abcdef12"}',
    );
  });

  it("lowercases field named 'worker'", () => {
    const obj = { worker: "0xABCDEF1234567890ABCDEF1234567890ABCDEF12" };
    expect(canonicalize(obj)).toBe(
      '{"worker":"0xabcdef1234567890abcdef1234567890abcdef12"}',
    );
  });

  it("lowercases field named 'token'", () => {
    const obj = { token: "0xABCDEF1234567890ABCDEF1234567890ABCDEF12" };
    expect(canonicalize(obj)).toBe(
      '{"token":"0xabcdef1234567890abcdef1234567890abcdef12"}',
    );
  });

  it("lowercases field ending in 'Address'", () => {
    const obj = { escrowContractAddress: "0xABCDEF1234567890ABCDEF1234567890ABCDEF12" };
    expect(canonicalize(obj)).toBe(
      '{"escrowContractAddress":"0xabcdef1234567890abcdef1234567890abcdef12"}',
    );
  });

  it("lowercases field named 'caseWalletAddress'", () => {
    const obj = { caseWalletAddress: "0xABCDEF1234567890ABCDEF1234567890ABCDEF12" };
    expect(canonicalize(obj)).toBe(
      '{"caseWalletAddress":"0xabcdef1234567890abcdef1234567890abcdef12"}',
    );
  });

  it("lowercases field ending in 'funderAddress' (ends with Address)", () => {
    const obj = { funderAddress: "0xABCDEF1234567890ABCDEF1234567890ABCDEF12" };
    expect(canonicalize(obj)).toBe(
      '{"funderAddress":"0xabcdef1234567890abcdef1234567890abcdef12"}',
    );
  });

  it("does not lowercase ordinary string fields", () => {
    const obj = { name: "Alice", status: "ACTIVE" };
    expect(canonicalize(obj)).toBe('{"name":"Alice","status":"ACTIVE"}');
  });

  it("normalizes addresses inside nested objects", () => {
    const obj = {
      escrow: { client: "0xABCDEF1234567890ABCDEF1234567890ABCDEF12" },
      other: "KEEP_CASE",
    };
    expect(canonicalize(obj)).toBe(
      '{"escrow":{"client":"0xabcdef1234567890abcdef1234567890abcdef12"},"other":"KEEP_CASE"}',
    );
  });
});

describe("canonicalize — edge cases and error handling", () => {
  it("throws on NaN", () => {
    expect(() => canonicalize(NaN)).toThrow();
  });

  it("throws on Infinity", () => {
    expect(() => canonicalize(Infinity)).toThrow();
  });

  it("throws on -Infinity", () => {
    expect(() => canonicalize(-Infinity)).toThrow();
  });

  it("throws on a function", () => {
    expect(() => canonicalize(() => {})).toThrow();
  });

  it("throws on a Symbol", () => {
    expect(() => canonicalize(Symbol("test"))).toThrow();
  });

  it("throws on Map", () => {
    expect(() => canonicalize(new Map())).toThrow();
  });

  it("throws on Set", () => {
    expect(() => canonicalize(new Set())).toThrow();
  });

  it("supports deep nesting up to reasonable depth", () => {
    const deep = { a: { b: { c: { d: { e: { f: "value" } } } } } };
    expect(() => canonicalize(deep)).not.toThrow();
    expect(canonicalize(deep)).toContain('"value"');
  });
});

describe("canonicalize — stability (same input, same output)", () => {
  it("produces identical output for identical structurally-different inputs", () => {
    const obj1 = { b: "y", a: "x" };
    const obj2 = { a: "x", b: "y" };
    expect(canonicalize(obj1)).toBe(canonicalize(obj2));
  });

  it("produces identical output across multiple calls", () => {
    const input = {
      caseIdentity: { escrowPaymentId: "42", escrowChainId: "11142220", escrowContractAddress: "0xaaaa000000000000000000000000000000000000aaaa" },
      state: "funded" as const,
    };
    const h1 = canonicalize(input);
    const h2 = canonicalize(input);
    const h3 = canonicalize(input);
    expect(h1).toBe(h2);
    expect(h2).toBe(h3);
  });
});

describe("canonicalize — bigint in objects and arrays", () => {
  it("serializes bigint in object as string", () => {
    const obj = { amount: 1000000000000000000n };
    expect(canonicalize(obj)).toBe('{"amount":"1000000000000000000"}');
  });

  it("serializes bigint in array as string", () => {
    const arr = [1n, 2n, 3n];
    expect(canonicalize(arr)).toBe('["1","2","3"]');
  });

  it("serializes mixed bigint and number", () => {
    const obj = { a: 100n, b: 200 };
    expect(canonicalize(obj)).toBe('{"a":"100","b":200}');
  });
});
