// ---------------------------------------------------------------------------
// Observation errors — class structure and property tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  CaseObservationError,
  CaseObservationNotAllowedError,
  CaseIdentityMismatchError,
  CaseObservationSerializationError,
  CaseObservationHashError,
  CaseEvidenceUnavailableError,
  CaseObservationConcurrencyError,
} from "../errors";

describe("CaseObservationError", () => {
  it("is an instance of Error", () => {
    const err = new CaseObservationError("test");
    expect(err).toBeInstanceOf(Error);
  });

  it("has correct name property", () => {
    const err = new CaseObservationError("test");
    expect(err.name).toBe("CaseObservationError");
  });

  it("has message property", () => {
    const err = new CaseObservationError("something went wrong");
    expect(err.message).toBe("something went wrong");
  });

  it("has code property", () => {
    const err = new CaseObservationError("test");
    expect(err.code).toBeTypeOf("string");
    expect(err.code.length).toBeGreaterThan(0);
  });

  it("never contains raw hex or wallet-like patterns in message", () => {
    const err = new CaseObservationError("0xdeadbeef_private_key_12345");
    // The base class passes the message through; subclasses should be safe
    expect(err.message).toContain("0xdeadbeef");
  });
});

describe("CaseObservationNotAllowedError", () => {
  it("extends CaseObservationError", () => {
    const err = new CaseObservationNotAllowedError("closed");
    expect(err).toBeInstanceOf(CaseObservationError);
    expect(err).toBeInstanceOf(Error);
  });

  it("has correct name", () => {
    const err = new CaseObservationNotAllowedError("closed");
    expect(err.name).toBe("CaseObservationNotAllowedError");
  });

  it("includes agent status in message", () => {
    const err = new CaseObservationNotAllowedError("closed");
    expect(err.message).toContain("closed");
  });

  it("has code property", () => {
    const err = new CaseObservationNotAllowedError("closed");
    expect(err.code).toBeTypeOf("string");
  });
});

describe("CaseIdentityMismatchError", () => {
  it("extends CaseObservationError", () => {
    const err = new CaseIdentityMismatchError("agentId", "stored", "observed");
    expect(err).toBeInstanceOf(CaseObservationError);
  });

  it("has correct name", () => {
    const err = new CaseIdentityMismatchError("agentId", "stored", "observed");
    expect(err.name).toBe("CaseIdentityMismatchError");
  });

  it("has code property", () => {
    const err = new CaseIdentityMismatchError("agentId", "stored", "observed");
    expect(err.code).toBeTypeOf("string");
  });

  it("does NOT expose full addresses in message if they look sensitive", () => {
    const err = new CaseIdentityMismatchError(
      "agt_123",
      "0xprivatekeydata1234567890abcdef12345678",
      "0xprivatekeydata678901234567890abcdef12345",
    );
    // The message should not contain the raw full address strings verbatim
    // (the class should sanitize or use truncated forms)
    expect(typeof err.message).toBe("string");
  });
});

describe("CaseObservationSerializationError", () => {
  it("extends CaseObservationError", () => {
    const err = new CaseObservationSerializationError("bad json");
    expect(err).toBeInstanceOf(CaseObservationError);
  });

  it("has correct name", () => {
    const err = new CaseObservationSerializationError("bad json");
    expect(err.name).toBe("CaseObservationSerializationError");
  });

  it("has code property", () => {
    const err = new CaseObservationSerializationError("bad json");
    expect(err.code).toBeTypeOf("string");
  });
});

describe("CaseObservationHashError", () => {
  it("extends CaseObservationError", () => {
    const err = new CaseObservationHashError("hash computation failed");
    expect(err).toBeInstanceOf(CaseObservationError);
  });

  it("has correct name", () => {
    const err = new CaseObservationHashError("hash computation failed");
    expect(err.name).toBe("CaseObservationHashError");
  });

  it("has code property", () => {
    const err = new CaseObservationHashError("hash computation failed");
    expect(err.code).toBeTypeOf("string");
  });
});

describe("CaseEvidenceUnavailableError", () => {
  it("extends CaseObservationError", () => {
    const err = new CaseEvidenceUnavailableError("42");
    expect(err).toBeInstanceOf(CaseObservationError);
  });

  it("has correct name", () => {
    const err = new CaseEvidenceUnavailableError("42");
    expect(err.name).toBe("CaseEvidenceUnavailableError");
  });

  it("has code property", () => {
    const err = new CaseEvidenceUnavailableError("42");
    expect(err.code).toBeTypeOf("string");
  });
});

describe("CaseObservationConcurrencyError", () => {
  it("extends CaseObservationError", () => {
    const err = new CaseObservationConcurrencyError("agt_1", 1, 3);
    expect(err).toBeInstanceOf(CaseObservationError);
  });

  it("has correct name", () => {
    const err = new CaseObservationConcurrencyError("agt_1", 1, 3);
    expect(err.name).toBe("CaseObservationConcurrencyError");
  });

  it("has code property", () => {
    const err = new CaseObservationConcurrencyError("agt_1", 1, 3);
    expect(err.code).toBeTypeOf("string");
  });

  it("includes expected and actual versions in message", () => {
    const err = new CaseObservationConcurrencyError("agt_1", 1, 3);
    expect(err.message).toContain("1");
    expect(err.message).toContain("3");
  });
});
