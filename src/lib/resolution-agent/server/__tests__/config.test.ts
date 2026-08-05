import { describe, it, expect } from "vitest";
import {
  parseWalletEncryptionKey,
  WALLET_ENCRYPTION_KEY_ENV,
  WALLET_ENCRYPTION_KEY_BYTES,
} from "../config";
import { WalletEncryptionConfigurationError } from "../../errors";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A valid 32-byte key encoded as base64 for use in tests. */
function validKeyBase64(): string {
  return Buffer.alloc(32).fill(0xab).toString("base64");
}

function keyOfLength(bytes: number): string {
  return Buffer.alloc(bytes).fill(0xcd).toString("base64");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WALLET_ENCRYPTION_KEY_ENV", () => {
  it("has the correct constant value", () => {
    expect(WALLET_ENCRYPTION_KEY_ENV).toBe(
      "RESOLUTION_AGENT_WALLET_ENCRYPTION_KEY",
    );
  });
});

describe("WALLET_ENCRYPTION_KEY_BYTES", () => {
  it("has the correct constant value", () => {
    expect(WALLET_ENCRYPTION_KEY_BYTES).toBe(32);
  });
});

describe("parseWalletEncryptionKey", () => {
  describe("valid inputs", () => {
    it("accepts a valid base64-encoded 32-byte key", () => {
      const key = parseWalletEncryptionKey(validKeyBase64());
      expect(key).toBeInstanceOf(Buffer);
      expect(key).toHaveLength(32);
    });

    it("decodes the base64 value correctly", () => {
      const key = parseWalletEncryptionKey(validKeyBase64());
      const expected = Buffer.alloc(32).fill(0xab);
      expect(key.equals(expected)).toBe(true);
    });
  });

  describe("missing key", () => {
    it("rejects when the value is undefined", () => {
      expect(() =>
        parseWalletEncryptionKey(undefined),
      ).toThrow(WalletEncryptionConfigurationError);
    });

    it("rejects when the value is an empty string", () => {
      expect(() => parseWalletEncryptionKey("")).toThrow(
        WalletEncryptionConfigurationError,
      );
    });
  });

  describe("malformed base64", () => {
    it("rejects completely invalid base64", () => {
      expect(() =>
        parseWalletEncryptionKey("!!!not-valid-base64!!!"),
      ).toThrow(WalletEncryptionConfigurationError);
    });

    it("rejects base64 with invalid characters", () => {
      expect(() =>
        parseWalletEncryptionKey("YWJjZGVm@@@"),
      ).toThrow(WalletEncryptionConfigurationError);
    });
  });

  describe("incorrect decoded length", () => {
    it("rejects a 31-byte decoded key", () => {
      expect(() =>
        parseWalletEncryptionKey(keyOfLength(31)),
      ).toThrow(WalletEncryptionConfigurationError);
    });

    it("rejects a 33-byte decoded key", () => {
      expect(() =>
        parseWalletEncryptionKey(keyOfLength(33)),
      ).toThrow(WalletEncryptionConfigurationError);
    });

    it("rejects a 16-byte decoded key (too short)", () => {
      expect(() =>
        parseWalletEncryptionKey(keyOfLength(16)),
      ).toThrow(WalletEncryptionConfigurationError);
    });

    it("rejects a 64-byte decoded key (too long)", () => {
      expect(() =>
        parseWalletEncryptionKey(keyOfLength(64)),
      ).toThrow(WalletEncryptionConfigurationError);
    });
  });

  describe("error message hygiene", () => {
    it("does not leak the supplied key value in error messages (valid length but wrong bytes)", () => {
      const badKey = keyOfLength(33);
      try {
        parseWalletEncryptionKey(badKey);
        expect.fail("Expected parseWalletEncryptionKey to throw");
      } catch (err) {
        const message = String(
          err instanceof Error ? err.message : err,
        );
        // The base64-encoded value should not appear in the error message
        expect(message).not.toContain(badKey);
      }
    });

    it("does not leak the supplied key value in error messages (malformed base64)", () => {
      const badKey = "!!!not-valid-base64!!!";
      try {
        parseWalletEncryptionKey(badKey);
        expect.fail("Expected parseWalletEncryptionKey to throw");
      } catch (err) {
        const message = String(
          err instanceof Error ? err.message : err,
        );
        expect(message).not.toContain(badKey);
      }
    });
  });

  describe("lazy evaluation", () => {
    it("can be imported without the env var being set", () => {
      // parseWalletEncryptionKey takes the value as a parameter — it does
      // not read process.env at import time. The function reference itself
      // is always importable.
      expect(typeof parseWalletEncryptionKey).toBe("function");
    });

    it("can be called with a value read from process.env at runtime", () => {
      // The key function takes the raw value as a parameter, so callers
      // control whether/how to read the env var. Verify it works when
      // passed a valid env-var-derived value.
      const previous = process.env[WALLET_ENCRYPTION_KEY_ENV];
      try {
        process.env[WALLET_ENCRYPTION_KEY_ENV] = validKeyBase64();
        const key = parseWalletEncryptionKey(
          process.env[WALLET_ENCRYPTION_KEY_ENV],
        );
        expect(key).toHaveLength(32);
      } finally {
        if (previous === undefined) {
          delete process.env[WALLET_ENCRYPTION_KEY_ENV];
        } else {
          process.env[WALLET_ENCRYPTION_KEY_ENV] = previous;
        }
      }
    });

    it("only rejects when actually called with a bad value", () => {
      // The function reference is fine; the error surfaces on invocation
      // with a bad parameter value.
      expect(() => parseWalletEncryptionKey(undefined)).toThrow(
        WalletEncryptionConfigurationError,
      );
    });
  });
});
