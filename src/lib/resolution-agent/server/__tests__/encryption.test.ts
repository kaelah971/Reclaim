import { describe, it, expect } from "vitest";
import {
  encryptCaseWalletPrivateKey,
  decryptCaseWalletPrivateKey,
  withDecryptedCaseWalletAccount,
  createAssociatedData,
} from "../encryption";
import {
  InvalidEncryptedWalletSecretError,
  WalletDecryptionError,
  WalletEncryptionError,
} from "../../errors";
import type { AgentCaseIdentity, EncryptedWalletSecret } from "../../types";

// ---------------------------------------------------------------------------
// Shared Test Fixtures
// ---------------------------------------------------------------------------

const TEST_ENCRYPTION_KEY: Buffer = Buffer.alloc(32).fill(0x42);

const TEST_CASE_IDENTITY: AgentCaseIdentity = {
  escrowPaymentId: "pay_test_enc_001",
  escrowChainId: "eip155:42220",
  escrowContractAddress: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
};

const TEST_AGENT_ID = "agent_enc_test_1";

const TEST_PRIVATE_KEY = "0x" + "42".repeat(32);

/** An alternative valid private key for address-derivation tests. */
const ALT_PRIVATE_KEY = "0x" + "7a".repeat(32);

/** A completely different 32-byte key for "wrong key" tests. */
const WRONG_ENCRYPTION_KEY: Buffer = Buffer.alloc(32).fill(0x99);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Encrypts the given private key (or TEST_PRIVATE_KEY) with the standard
 * test fixtures and returns the resulting EncryptedWalletSecret.
 */
function createBasicEncryptedSecret(
  spk: AgentCaseIdentity = TEST_CASE_IDENTITY,
  aid: string = TEST_AGENT_ID,
  ek: Buffer = TEST_ENCRYPTION_KEY,
  pk: string = TEST_PRIVATE_KEY,
): EncryptedWalletSecret {
  return encryptCaseWalletPrivateKey({
    privateKey: pk,
    caseIdentity: spk,
    agentId: aid,
    encryptionKey: ek,
  });
}

// ---------------------------------------------------------------------------
// Encryption Basics
// ---------------------------------------------------------------------------

describe("encryptCaseWalletPrivateKey", () => {
  describe("basic round-trip", () => {
    it("encrypts and decrypts successfully", () => {
      const secret = encryptCaseWalletPrivateKey({
        privateKey: TEST_PRIVATE_KEY,
        caseIdentity: TEST_CASE_IDENTITY,
        agentId: TEST_AGENT_ID,
        encryptionKey: TEST_ENCRYPTION_KEY,
      });
      const decrypted = decryptCaseWalletPrivateKey({
        encryptedSecret: secret,
        caseIdentity: TEST_CASE_IDENTITY,
        agentId: TEST_AGENT_ID,
        encryptionKey: TEST_ENCRYPTION_KEY,
      });
      expect(decrypted).toBe(TEST_PRIVATE_KEY);
    });

    it("decrypted key equals the original synthetic test key", () => {
      const secret = createBasicEncryptedSecret();
      const decrypted = decryptCaseWalletPrivateKey({
        encryptedSecret: secret,
        caseIdentity: TEST_CASE_IDENTITY,
        agentId: TEST_AGENT_ID,
        encryptionKey: TEST_ENCRYPTION_KEY,
      });
      expect(decrypted).toBe(TEST_PRIVATE_KEY);
    });
  });

  describe("nonce / IV uniqueness", () => {
    it("same key encrypted twice produces different IVs", () => {
      const secret1 = createBasicEncryptedSecret();
      const secret2 = createBasicEncryptedSecret();

      const iv1 = Buffer.from(secret1.iv, "base64");
      const iv2 = Buffer.from(secret2.iv, "base64");

      expect(iv1.equals(iv2)).toBe(false);
    });

    it("same key encrypted twice produces different ciphertexts", () => {
      const secret1 = createBasicEncryptedSecret();
      const secret2 = createBasicEncryptedSecret();

      expect(secret1.ciphertext).not.toBe(secret2.ciphertext);
    });
  });

  describe("envelope structure", () => {
    it("envelope version is 1", () => {
      const secret = createBasicEncryptedSecret();
      expect(secret.version).toBe(1);
    });

    it('envelope algorithm is "AES-256-GCM"', () => {
      const secret = createBasicEncryptedSecret();
      expect(secret.algorithm).toBe("AES-256-GCM");
    });

    it("IV is exactly 12 bytes after base64 decoding", () => {
      const secret = createBasicEncryptedSecret();
      const ivBuffer = Buffer.from(secret.iv, "base64");
      expect(ivBuffer).toHaveLength(12);
    });

    it("authentication tag has the correct decoded length (16 bytes)", () => {
      const secret = createBasicEncryptedSecret();
      const tagBuffer = Buffer.from(secret.authenticationTag, "base64");
      expect(tagBuffer).toHaveLength(16);
    });

    it("ciphertext is non-empty after base64 decode", () => {
      const secret = createBasicEncryptedSecret();
      const ctBuffer = Buffer.from(secret.ciphertext, "base64");
      expect(ctBuffer.length).toBeGreaterThan(0);
    });
  });

  describe("input validation", () => {
    it("rejects malformed private key (not 0x-prefixed)", () => {
      const badKey = "42".repeat(32); // Missing 0x prefix
      expect(() =>
        encryptCaseWalletPrivateKey({
          privateKey: badKey,
          caseIdentity: TEST_CASE_IDENTITY,
          agentId: TEST_AGENT_ID,
          encryptionKey: TEST_ENCRYPTION_KEY,
        }),
      ).toThrow(WalletEncryptionError);
    });

    it("rejects malformed private key (wrong length)", () => {
      const tooShort = "0x" + "42".repeat(30); // 60 hex chars (30 bytes)
      expect(() =>
        encryptCaseWalletPrivateKey({
          privateKey: tooShort,
          caseIdentity: TEST_CASE_IDENTITY,
          agentId: TEST_AGENT_ID,
          encryptionKey: TEST_ENCRYPTION_KEY,
        }),
      ).toThrow(WalletEncryptionError);
    });

    it("rejects empty private key", () => {
      expect(() =>
        encryptCaseWalletPrivateKey({
          privateKey: "",
          caseIdentity: TEST_CASE_IDENTITY,
          agentId: TEST_AGENT_ID,
          encryptionKey: TEST_ENCRYPTION_KEY,
        }),
      ).toThrow(WalletEncryptionError);
    });

    it("rejects non-hex private key characters", () => {
      const badHex = "0x" + "ZZ".repeat(32);
      expect(() =>
        encryptCaseWalletPrivateKey({
          privateKey: badHex,
          caseIdentity: TEST_CASE_IDENTITY,
          agentId: TEST_AGENT_ID,
          encryptionKey: TEST_ENCRYPTION_KEY,
        }),
      ).toThrow(WalletEncryptionError);
    });
  });
});

// ---------------------------------------------------------------------------
// Authentication and Tamper Resistance
// ---------------------------------------------------------------------------

describe("decryptCaseWalletPrivateKey — tamper resistance", () => {
  function getValidSecret(): EncryptedWalletSecret {
    return createBasicEncryptedSecret();
  }

  it("changed ciphertext fails decryption", () => {
    const secret = getValidSecret();
    const ct = Buffer.from(secret.ciphertext, "base64");
    ct[0] = ct[0] ^ 0xff;
    const tampered = { ...secret, ciphertext: ct.toString("base64") };

    expect(() =>
      decryptCaseWalletPrivateKey({
        encryptedSecret: tampered,
        caseIdentity: TEST_CASE_IDENTITY,
        agentId: TEST_AGENT_ID,
        encryptionKey: TEST_ENCRYPTION_KEY,
      }),
    ).toThrow(WalletDecryptionError);
  });

  it("changed IV fails decryption", () => {
    const secret = getValidSecret();
    const iv = Buffer.from(secret.iv, "base64");
    iv[0] = iv[0] ^ 0xff;
    const tampered = { ...secret, iv: iv.toString("base64") };

    expect(() =>
      decryptCaseWalletPrivateKey({
        encryptedSecret: tampered,
        caseIdentity: TEST_CASE_IDENTITY,
        agentId: TEST_AGENT_ID,
        encryptionKey: TEST_ENCRYPTION_KEY,
      }),
    ).toThrow(WalletDecryptionError);
  });

  it("changed authentication tag fails decryption", () => {
    const secret = getValidSecret();
    const tag = Buffer.from(secret.authenticationTag, "base64");
    tag[0] = tag[0] ^ 0xff;
    const tampered = {
      ...secret,
      authenticationTag: tag.toString("base64"),
    };

    expect(() =>
      decryptCaseWalletPrivateKey({
        encryptedSecret: tampered,
        caseIdentity: TEST_CASE_IDENTITY,
        agentId: TEST_AGENT_ID,
        encryptionKey: TEST_ENCRYPTION_KEY,
      }),
    ).toThrow(WalletDecryptionError);
  });

  it("wrong encryption key fails decryption", () => {
    const secret = getValidSecret();

    expect(() =>
      decryptCaseWalletPrivateKey({
        encryptedSecret: secret,
        caseIdentity: TEST_CASE_IDENTITY,
        agentId: TEST_AGENT_ID,
        encryptionKey: WRONG_ENCRYPTION_KEY,
      }),
    ).toThrow(WalletDecryptionError);
  });

  it("wrong agent ID fails decryption", () => {
    const secret = getValidSecret();

    expect(() =>
      decryptCaseWalletPrivateKey({
        encryptedSecret: secret,
        caseIdentity: TEST_CASE_IDENTITY,
        agentId: "different_agent_id",
        encryptionKey: TEST_ENCRYPTION_KEY,
      }),
    ).toThrow(WalletDecryptionError);
  });

  it("wrong payment ID fails decryption", () => {
    const secret = getValidSecret();
    const wrongIdentity: AgentCaseIdentity = {
      ...TEST_CASE_IDENTITY,
      escrowPaymentId: "different_payment_id",
    };

    expect(() =>
      decryptCaseWalletPrivateKey({
        encryptedSecret: secret,
        caseIdentity: wrongIdentity,
        agentId: TEST_AGENT_ID,
        encryptionKey: TEST_ENCRYPTION_KEY,
      }),
    ).toThrow(WalletDecryptionError);
  });

  it("wrong escrow chain ID fails decryption", () => {
    const secret = getValidSecret();
    const wrongIdentity: AgentCaseIdentity = {
      ...TEST_CASE_IDENTITY,
      escrowChainId: "eip155:1",
    };

    expect(() =>
      decryptCaseWalletPrivateKey({
        encryptedSecret: secret,
        caseIdentity: wrongIdentity,
        agentId: TEST_AGENT_ID,
        encryptionKey: TEST_ENCRYPTION_KEY,
      }),
    ).toThrow(WalletDecryptionError);
  });

  it("wrong escrow contract address fails decryption", () => {
    const secret = getValidSecret();
    const wrongIdentity: AgentCaseIdentity = {
      ...TEST_CASE_IDENTITY,
      escrowContractAddress:
        "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    };

    expect(() =>
      decryptCaseWalletPrivateKey({
        encryptedSecret: secret,
        caseIdentity: wrongIdentity,
        agentId: TEST_AGENT_ID,
        encryptionKey: TEST_ENCRYPTION_KEY,
      }),
    ).toThrow(WalletDecryptionError);
  });

  describe("typed error safety", () => {
    it("all tamper failures return typed WalletDecryptionError", () => {
      const secret = getValidSecret();
      const ct = Buffer.from(secret.ciphertext, "base64");
      ct[0] = ct[0] ^ 0xff;
      const tampered = { ...secret, ciphertext: ct.toString("base64") };

      try {
        decryptCaseWalletPrivateKey({
          encryptedSecret: tampered,
          caseIdentity: TEST_CASE_IDENTITY,
          agentId: TEST_AGENT_ID,
          encryptionKey: TEST_ENCRYPTION_KEY,
        });
        expect.fail("Expected WalletDecryptionError to be thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(WalletDecryptionError);
      }
    });

    it("errors do not expose private key in message", () => {
      const secret = getValidSecret();
      const ct = Buffer.from(secret.ciphertext, "base64");
      ct[0] = ct[0] ^ 0xff;
      const tampered = { ...secret, ciphertext: ct.toString("base64") };

      try {
        decryptCaseWalletPrivateKey({
          encryptedSecret: tampered,
          caseIdentity: TEST_CASE_IDENTITY,
          agentId: TEST_AGENT_ID,
          encryptionKey: TEST_ENCRYPTION_KEY,
        });
      } catch (err) {
        const message = String(
          err instanceof Error ? err.message : err,
        );
        expect(message).not.toContain(TEST_PRIVATE_KEY);
      }
    });

    it("errors do not expose encryption key bytes in message", () => {
      const secret = getValidSecret();

      try {
        decryptCaseWalletPrivateKey({
          encryptedSecret: secret,
          caseIdentity: TEST_CASE_IDENTITY,
          agentId: TEST_AGENT_ID,
          encryptionKey: WRONG_ENCRYPTION_KEY,
        });
      } catch (err) {
        const message = String(
          err instanceof Error ? err.message : err,
        );
        // The raw synthetic key should not appear
        expect(message).not.toContain(
          TEST_ENCRYPTION_KEY.toString("hex"),
        );
      }
    });

    it("errors do not expose raw ciphertext in message", () => {
      const secret = getValidSecret();
      const ct = Buffer.from(secret.ciphertext, "base64");
      ct[0] = ct[0] ^ 0xff;
      const tampered = { ...secret, ciphertext: ct.toString("base64") };

      try {
        decryptCaseWalletPrivateKey({
          encryptedSecret: tampered,
          caseIdentity: TEST_CASE_IDENTITY,
          agentId: TEST_AGENT_ID,
          encryptionKey: TEST_ENCRYPTION_KEY,
        });
      } catch (err) {
        const message = String(
          err instanceof Error ? err.message : err,
        );
        expect(message).not.toContain(secret.ciphertext);
        expect(message).not.toContain(tampered.ciphertext);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Envelope Validation (structural checks before decryption)
// ---------------------------------------------------------------------------

describe("decryptCaseWalletPrivateKey — envelope validation", () => {
  function getValidSecret(): EncryptedWalletSecret {
    return createBasicEncryptedSecret();
  }

  it("rejects unsupported version (version 0)", () => {
    const secret = getValidSecret();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bad = { ...secret, version: 0 } as any;
    expect(() =>
      decryptCaseWalletPrivateKey({
        encryptedSecret: bad,
        caseIdentity: TEST_CASE_IDENTITY,
        agentId: TEST_AGENT_ID,
        encryptionKey: TEST_ENCRYPTION_KEY,
      }),
    ).toThrow(InvalidEncryptedWalletSecretError);
  });

  it("rejects unsupported version (version 99)", () => {
    const secret = getValidSecret();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bad = { ...secret, version: 99 } as any;
    expect(() =>
      decryptCaseWalletPrivateKey({
        encryptedSecret: bad,
        caseIdentity: TEST_CASE_IDENTITY,
        agentId: TEST_AGENT_ID,
        encryptionKey: TEST_ENCRYPTION_KEY,
      }),
    ).toThrow(InvalidEncryptedWalletSecretError);
  });

  it("rejects unsupported algorithm", () => {
    const secret = getValidSecret();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bad = { ...secret, algorithm: "AES-128-CBC" } as any;
    expect(() =>
      decryptCaseWalletPrivateKey({
        encryptedSecret: bad,
        caseIdentity: TEST_CASE_IDENTITY,
        agentId: TEST_AGENT_ID,
        encryptionKey: TEST_ENCRYPTION_KEY,
      }),
    ).toThrow(InvalidEncryptedWalletSecretError);
  });

  it("rejects empty ciphertext", () => {
    const secret = getValidSecret();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bad = { ...secret, ciphertext: "" } as any;
    expect(() =>
      decryptCaseWalletPrivateKey({
        encryptedSecret: bad,
        caseIdentity: TEST_CASE_IDENTITY,
        agentId: TEST_AGENT_ID,
        encryptionKey: TEST_ENCRYPTION_KEY,
      }),
    ).toThrow(InvalidEncryptedWalletSecretError);
  });

  it("rejects invalid base64 ciphertext", () => {
    const secret = getValidSecret();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bad = { ...secret, ciphertext: "!!!!!!" } as any;
    expect(() =>
      decryptCaseWalletPrivateKey({
        encryptedSecret: bad,
        caseIdentity: TEST_CASE_IDENTITY,
        agentId: TEST_AGENT_ID,
        encryptionKey: TEST_ENCRYPTION_KEY,
      }),
    ).toThrow(InvalidEncryptedWalletSecretError);
  });

  it("rejects invalid base64 IV", () => {
    const secret = getValidSecret();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bad = { ...secret, iv: "!!!not-base64!!!" } as any;
    expect(() =>
      decryptCaseWalletPrivateKey({
        encryptedSecret: bad,
        caseIdentity: TEST_CASE_IDENTITY,
        agentId: TEST_AGENT_ID,
        encryptionKey: TEST_ENCRYPTION_KEY,
      }),
    ).toThrow(InvalidEncryptedWalletSecretError);
  });

  it("rejects wrong IV length after decode (e.g., 0 bytes)", () => {
    const secret = getValidSecret();
    const bad: EncryptedWalletSecret = {
      ...secret,
      iv: Buffer.alloc(0).toString("base64"),
    };
    expect(() =>
      decryptCaseWalletPrivateKey({
        encryptedSecret: bad,
        caseIdentity: TEST_CASE_IDENTITY,
        agentId: TEST_AGENT_ID,
        encryptionKey: TEST_ENCRYPTION_KEY,
      }),
    ).toThrow(InvalidEncryptedWalletSecretError);
  });

  it("rejects wrong IV length after decode (e.g., 16 bytes)", () => {
    const secret = getValidSecret();
    const bad: EncryptedWalletSecret = {
      ...secret,
      iv: Buffer.alloc(16).fill(0x01).toString("base64"),
    };
    expect(() =>
      decryptCaseWalletPrivateKey({
        encryptedSecret: bad,
        caseIdentity: TEST_CASE_IDENTITY,
        agentId: TEST_AGENT_ID,
        encryptionKey: TEST_ENCRYPTION_KEY,
      }),
    ).toThrow(InvalidEncryptedWalletSecretError);
  });

  it("rejects missing required fields (ciphertext)", () => {
    const secret = getValidSecret();
    const { ciphertext: _, ...withoutCiphertext } = secret;
    expect(() =>
      decryptCaseWalletPrivateKey({
        encryptedSecret: withoutCiphertext as unknown as EncryptedWalletSecret,
        caseIdentity: TEST_CASE_IDENTITY,
        agentId: TEST_AGENT_ID,
        encryptionKey: TEST_ENCRYPTION_KEY,
      }),
    ).toThrow(InvalidEncryptedWalletSecretError);
  });

  it("rejects missing IV", () => {
    const secret = getValidSecret();
    const { iv: _, ...withoutIV } = secret;
    expect(() =>
      decryptCaseWalletPrivateKey({
        encryptedSecret: withoutIV as unknown as EncryptedWalletSecret,
        caseIdentity: TEST_CASE_IDENTITY,
        agentId: TEST_AGENT_ID,
        encryptionKey: TEST_ENCRYPTION_KEY,
      }),
    ).toThrow(InvalidEncryptedWalletSecretError);
  });

  it("rejects missing authentication tag", () => {
    const secret = getValidSecret();
    const { authenticationTag: _, ...withoutTag } = secret;
    expect(() =>
      decryptCaseWalletPrivateKey({
        encryptedSecret: withoutTag as unknown as EncryptedWalletSecret,
        caseIdentity: TEST_CASE_IDENTITY,
        agentId: TEST_AGENT_ID,
        encryptionKey: TEST_ENCRYPTION_KEY,
      }),
    ).toThrow(InvalidEncryptedWalletSecretError);
  });
});

// ---------------------------------------------------------------------------
// AAD (Associated Authenticated Data) Tests
// ---------------------------------------------------------------------------

describe("createAssociatedData", () => {
  it("produces deterministic output (same inputs → same buffer)", () => {
    const a = createAssociatedData({
      agentId: TEST_AGENT_ID,
      caseIdentity: TEST_CASE_IDENTITY,
    });
    const b = createAssociatedData({
      agentId: TEST_AGENT_ID,
      caseIdentity: TEST_CASE_IDENTITY,
    });
    expect(a.equals(b)).toBe(true);
  });

  it("returns a non-empty Buffer", () => {
    const aad = createAssociatedData({
      agentId: TEST_AGENT_ID,
      caseIdentity: TEST_CASE_IDENTITY,
    });
    expect(aad).toBeInstanceOf(Buffer);
    expect(aad.length).toBeGreaterThan(0);
  });

  it("different agentId produces different buffer", () => {
    const a = createAssociatedData({
      agentId: "agent_one",
      caseIdentity: TEST_CASE_IDENTITY,
    });
    const b = createAssociatedData({
      agentId: "agent_two",
      caseIdentity: TEST_CASE_IDENTITY,
    });
    expect(a.equals(b)).toBe(false);
  });

  it("different paymentId produces different buffer", () => {
    const a = createAssociatedData({
      agentId: TEST_AGENT_ID,
      caseIdentity: {
        ...TEST_CASE_IDENTITY,
        escrowPaymentId: "pay_AAA",
      },
    });
    const b = createAssociatedData({
      agentId: TEST_AGENT_ID,
      caseIdentity: {
        ...TEST_CASE_IDENTITY,
        escrowPaymentId: "pay_BBB",
      },
    });
    expect(a.equals(b)).toBe(false);
  });

  it("different escrowChainId produces different buffer", () => {
    const a = createAssociatedData({
      agentId: TEST_AGENT_ID,
      caseIdentity: {
        ...TEST_CASE_IDENTITY,
        escrowChainId: "eip155:42220",
      },
    });
    const b = createAssociatedData({
      agentId: TEST_AGENT_ID,
      caseIdentity: {
        ...TEST_CASE_IDENTITY,
        escrowChainId: "eip155:1",
      },
    });
    expect(a.equals(b)).toBe(false);
  });

  it("different escrowContractAddress produces different buffer", () => {
    const a = createAssociatedData({
      agentId: TEST_AGENT_ID,
      caseIdentity: {
        ...TEST_CASE_IDENTITY,
        escrowContractAddress:
          "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      },
    });
    const b = createAssociatedData({
      agentId: TEST_AGENT_ID,
      caseIdentity: {
        ...TEST_CASE_IDENTITY,
        escrowContractAddress:
          "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      },
    });
    expect(a.equals(b)).toBe(false);
  });

  it("includes all canonical fields in the AAD", () => {
    const baseAad = createAssociatedData({
      agentId: TEST_AGENT_ID,
      caseIdentity: TEST_CASE_IDENTITY,
    });

    // Change payment ID
    const changedPayment = createAssociatedData({
      agentId: TEST_AGENT_ID,
      caseIdentity: {
        ...TEST_CASE_IDENTITY,
        escrowPaymentId: "altered",
      },
    });
    expect(baseAad.equals(changedPayment)).toBe(false);

    // Change chain ID
    const changedChain = createAssociatedData({
      agentId: TEST_AGENT_ID,
      caseIdentity: {
        ...TEST_CASE_IDENTITY,
        escrowChainId: "eip155:99999",
      },
    });
    expect(baseAad.equals(changedChain)).toBe(false);

    // Change contract address
    const changedContract = createAssociatedData({
      agentId: TEST_AGENT_ID,
      caseIdentity: {
        ...TEST_CASE_IDENTITY,
        escrowContractAddress:
          "0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
      },
    });
    expect(baseAad.equals(changedContract)).toBe(false);

    // Change agent ID
    const changedAgent = createAssociatedData({
      agentId: "changed_agent",
      caseIdentity: TEST_CASE_IDENTITY,
    });
    expect(baseAad.equals(changedAgent)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// withDecryptedCaseWalletAccount
// ---------------------------------------------------------------------------

describe("withDecryptedCaseWalletAccount", () => {
  it("callback receives valid account with correct address", async () => {
    const secret = createBasicEncryptedSecret();

    await withDecryptedCaseWalletAccount(
      {
        encryptedSecret: secret,
        caseIdentity: TEST_CASE_IDENTITY,
        agentId: TEST_AGENT_ID,
        encryptionKey: TEST_ENCRYPTION_KEY,
      },
      async (account) => {
        expect(account).toBeDefined();
        expect(account.address).toBeDefined();
        expect(typeof account.address).toBe("string");
        // Address should be 0x-prefixed 40 hex chars
        expect(account.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      },
    );
  });

  it("callback's account address depends on the private key", async () => {
    const secret = createBasicEncryptedSecret();
    // Encrypt an alternative key so we can verify the address differs
    const altSecret = encryptCaseWalletPrivateKey({
      privateKey: ALT_PRIVATE_KEY,
      caseIdentity: TEST_CASE_IDENTITY,
      agentId: TEST_AGENT_ID,
      encryptionKey: TEST_ENCRYPTION_KEY,
    });

    let addressFromFirst: string | undefined;
    let addressFromSecond: string | undefined;

    await withDecryptedCaseWalletAccount(
      {
        encryptedSecret: secret,
        caseIdentity: TEST_CASE_IDENTITY,
        agentId: TEST_AGENT_ID,
        encryptionKey: TEST_ENCRYPTION_KEY,
      },
      async (account) => {
        addressFromFirst = account.address;
      },
    );

    await withDecryptedCaseWalletAccount(
      {
        encryptedSecret: altSecret,
        caseIdentity: TEST_CASE_IDENTITY,
        agentId: TEST_AGENT_ID,
        encryptionKey: TEST_ENCRYPTION_KEY,
      },
      async (account) => {
        addressFromSecond = account.address;
      },
    );

    // Different private keys should yield different addresses
    expect(addressFromFirst).toBeDefined();
    expect(addressFromSecond).toBeDefined();
    expect(addressFromFirst).not.toBe(addressFromSecond);
  });

  it("errors during callback are propagated", async () => {
    const secret = createBasicEncryptedSecret();
    const callbackError = new Error("Callback failure simulation");

    await expect(
      withDecryptedCaseWalletAccount(
        {
          encryptedSecret: secret,
          caseIdentity: TEST_CASE_IDENTITY,
          agentId: TEST_AGENT_ID,
          encryptionKey: TEST_ENCRYPTION_KEY,
        },
        async () => {
          throw callbackError;
        },
      ),
    ).rejects.toThrow(callbackError);
  });

  it("propagates decryption errors (tampered ciphertext)", async () => {
    const secret = createBasicEncryptedSecret();
    const ct = Buffer.from(secret.ciphertext, "base64");
    ct[0] = ct[0] ^ 0xff;
    const tampered = { ...secret, ciphertext: ct.toString("base64") };

    await expect(
      withDecryptedCaseWalletAccount(
        {
          encryptedSecret: tampered,
          caseIdentity: TEST_CASE_IDENTITY,
          agentId: TEST_AGENT_ID,
          encryptionKey: TEST_ENCRYPTION_KEY,
        },
        async () => {
          expect.fail("Callback should not be invoked on decryption failure");
        },
      ),
    ).rejects.toThrow(WalletDecryptionError);
  });
});
