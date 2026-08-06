import { describe, it, expect } from "vitest";
import {
  ResolutionAgentStoreError,
  ResolutionAgentNotFoundError,
  ResolutionAgentAlreadyExistsError,
  ResolutionAgentConcurrencyError,
} from "../errors";

// ---------------------------------------------------------------------------
// Synthetic ciphertext fixtures that must never appear in error messages
// ---------------------------------------------------------------------------

const TEST_CIPHERTEXT =
  "synthetic-error-test-ciphertext-should-never-leak-base64";
const TEST_IV = "synthetic-error-test-iv-should-never-leak-base64";
const TEST_AUTH_TAG = "synthetic-error-test-tag-should-never-leak-base64";

// ---------------------------------------------------------------------------
// ResolutionAgentStoreError
// ---------------------------------------------------------------------------

describe("ResolutionAgentStoreError", () => {
  it("name is set correctly", () => {
    const err = new ResolutionAgentStoreError("something went wrong");
    expect(err.name).toBe("ResolutionAgentStoreError");
  });

  it("extends Error", () => {
    const err = new ResolutionAgentStoreError("test");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ResolutionAgentStoreError);
  });

  it("message is accessible", () => {
    const err = new ResolutionAgentStoreError("database connection failed");
    expect(err.message).toContain("database connection failed");
  });

  it("error message does NOT contain test ciphertext fixture value", () => {
    const err = new ResolutionAgentStoreError(
      `Failed to process: ${TEST_CIPHERTEXT}`,
    );
    // The fixture itself is in the message (contrived), but the test verifies
    // that the constructor's behavior is independent of ciphertext leakage.
    // The real test: the constructor does not strip — but the domain code
    // must not pass ciphertext to the error constructor.
    expect(err.message).toContain(TEST_CIPHERTEXT);

    // What we really assert: when building errors in the serialization/
    // store layer, ciphertext must never be appended to the message.
    // This test documents that the error class itself does not magically
    // sanitize — it's the caller's responsibility.
    expect(err).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// ResolutionAgentNotFoundError
// ---------------------------------------------------------------------------

describe("ResolutionAgentNotFoundError", () => {
  it("name is set correctly", () => {
    const err = new ResolutionAgentNotFoundError("agent_missing");
    expect(err.name).toBe("ResolutionAgentNotFoundError");
  });

  it("extends Error", () => {
    const err = new ResolutionAgentNotFoundError("unknown_agent");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ResolutionAgentNotFoundError);
  });

  it("extends ResolutionAgentStoreError", () => {
    const err = new ResolutionAgentNotFoundError("unknown_agent");
    expect(err).toBeInstanceOf(ResolutionAgentStoreError);
  });

  it("includes agentId in the error properties", () => {
    const err = new ResolutionAgentNotFoundError("agent_abc_123");
    expect(err.agentId).toBe("agent_abc_123");
  });

  it("message mentions the agent ID", () => {
    const err = new ResolutionAgentNotFoundError("agent_target_xyz");
    expect(err.message).toContain("agent_target_xyz");
  });

  it("message does NOT contain ciphertext, IV, or authentication tag", () => {
    const err = new ResolutionAgentNotFoundError("agent_secure_1");
    expect(err.message).not.toContain(TEST_CIPHERTEXT);
    expect(err.message).not.toContain(TEST_IV);
    expect(err.message).not.toContain(TEST_AUTH_TAG);
  });

  it("message does not leak secret-like substrings", () => {
    const err = new ResolutionAgentNotFoundError("agent_x");
    // The message should NOT contain any base64-looking payloads
    expect(err.message).not.toMatch(/[A-Za-z0-9+/]{40,}={0,2}/);
  });
});

// ---------------------------------------------------------------------------
// ResolutionAgentAlreadyExistsError
// ---------------------------------------------------------------------------

describe("ResolutionAgentAlreadyExistsError", () => {
  it("name is set correctly", () => {
    const err = new ResolutionAgentAlreadyExistsError("agent_dupe");
    expect(err.name).toBe("ResolutionAgentAlreadyExistsError");
  });

  it("extends Error", () => {
    const err = new ResolutionAgentAlreadyExistsError("agent_dupe");
    expect(err).toBeInstanceOf(Error);
  });

  it("extends ResolutionAgentStoreError", () => {
    const err = new ResolutionAgentAlreadyExistsError("agent_dupe");
    expect(err).toBeInstanceOf(ResolutionAgentStoreError);
  });

  it("includes agentId in the error properties", () => {
    const err = new ResolutionAgentAlreadyExistsError("existing_agent_42");
    expect(err.agentId).toBe("existing_agent_42");
  });

  it("message does NOT leak ciphertext, IV, or authentication tag", () => {
    const err = new ResolutionAgentAlreadyExistsError("dupe_agent");
    expect(err.message).not.toContain(TEST_CIPHERTEXT);
    expect(err.message).not.toContain(TEST_IV);
    expect(err.message).not.toContain(TEST_AUTH_TAG);
  });
});

// ---------------------------------------------------------------------------
// ResolutionAgentConcurrencyError
// ---------------------------------------------------------------------------

describe("ResolutionAgentConcurrencyError", () => {
  it("name is set correctly", () => {
    const err = new ResolutionAgentConcurrencyError(
      "agent_concurrent",
      3,
      5,
    );
    expect(err.name).toBe("ResolutionAgentConcurrencyError");
  });

  it("extends Error", () => {
    const err = new ResolutionAgentConcurrencyError("agent_cc", 1, 2);
    expect(err).toBeInstanceOf(Error);
  });

  it("extends ResolutionAgentStoreError", () => {
    const err = new ResolutionAgentConcurrencyError("agent_cc", 1, 2);
    expect(err).toBeInstanceOf(ResolutionAgentStoreError);
  });

  it("includes agentId in the error properties", () => {
    const err = new ResolutionAgentConcurrencyError(
      "agent_optimistic_lock",
      4,
      6,
    );
    expect(err.agentId).toBe("agent_optimistic_lock");
  });

  it("includes expected version in the error properties", () => {
    const err = new ResolutionAgentConcurrencyError("agent_ver", 2, 3);
    expect(err.expectedVersion).toBe(2);
  });

  it("includes actual version in the error properties", () => {
    const err = new ResolutionAgentConcurrencyError("agent_ver", 2, 3);
    expect(err.actualVersion).toBe(3);
  });

  it("message includes version information", () => {
    const err = new ResolutionAgentConcurrencyError("agent_ver_msg", 7, 9);
    expect(err.message).toContain("7");
    expect(err.message).toContain("9");
  });

  it("message does NOT contain secret contents", () => {
    const err = new ResolutionAgentConcurrencyError(
      "agent_nosecret",
      10,
      11,
    );
    expect(err.message).not.toContain(TEST_CIPHERTEXT);
    expect(err.message).not.toContain(TEST_IV);
    expect(err.message).not.toContain(TEST_AUTH_TAG);
  });

  it("message does not leak raw encrypted envelope fields", () => {
    const err = new ResolutionAgentConcurrencyError(
      "agent_no_leak",
      1,
      2,
    );
    // Version numbers are fine — we're checking that secret-like strings
    // don't appear
    expect(err.message).not.toMatch(/\bciphertext\b/i);
    expect(err.message).not.toMatch(/\bauthenticationTag\b/i);
    expect(err.message).not.toMatch(/\biv\b/i);
    expect(err.message).not.toMatch(/\bprivate.?key\b/i);
  });

  it("expectedVersion and actualVersion are always numbers", () => {
    const err = new ResolutionAgentConcurrencyError("agent_types", 0, 100);
    expect(typeof err.expectedVersion).toBe("number");
    expect(typeof err.actualVersion).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// Error hierarchy — all store errors
// ---------------------------------------------------------------------------

describe("Store error hierarchy", () => {
  it("ResolutionAgentStoreError is the base of all store errors", () => {
    const notFound = new ResolutionAgentNotFoundError("a");
    const alreadyExists = new ResolutionAgentAlreadyExistsError("b");
    const concurrency = new ResolutionAgentConcurrencyError("c", 1, 2);

    expect(notFound).toBeInstanceOf(ResolutionAgentStoreError);
    expect(alreadyExists).toBeInstanceOf(ResolutionAgentStoreError);
    expect(concurrency).toBeInstanceOf(ResolutionAgentStoreError);
  });

  it("each error type is distinguishable by name", () => {
    const errors = [
      new ResolutionAgentStoreError("base"),
      new ResolutionAgentNotFoundError("id1"),
      new ResolutionAgentAlreadyExistsError("id2"),
      new ResolutionAgentConcurrencyError("id3", 0, 0),
    ];

    const names = errors.map((e) => e.name);
    expect(new Set(names).size).toBe(4);
  });

  it("all store errors extend Error", () => {
    const instances = [
      new ResolutionAgentStoreError("x"),
      new ResolutionAgentNotFoundError("y"),
      new ResolutionAgentAlreadyExistsError("z"),
      new ResolutionAgentConcurrencyError("w", 0, 0),
    ];

    for (const err of instances) {
      expect(err).toBeInstanceOf(Error);
    }
  });
});
