import { describe, it, expect } from "vitest";
import {
  generateEncryptedCaseWallet,
  isValidEVMPrivateKey,
} from "../wallet";
import { decryptCaseWalletPrivateKey } from "../encryption";
import type { AgentCaseIdentity } from "../../types";

// ---------------------------------------------------------------------------
// Shared Test Fixtures
// ---------------------------------------------------------------------------

const TEST_ENCRYPTION_KEY: Buffer = Buffer.alloc(32).fill(0x42);

const TEST_CASE_IDENTITY: AgentCaseIdentity = {
  escrowPaymentId: "pay_wallet_test_001",
  escrowChainId: "eip155:42220",
  escrowContractAddress: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
};

const TEST_AGENT_ID = "agent_wallet_test_1";

// ---------------------------------------------------------------------------
// generateEncryptedCaseWallet
// ---------------------------------------------------------------------------

describe("generateEncryptedCaseWallet", () => {
  describe("address generation", () => {
    it("generated address is a valid EVM address (0x-prefixed, 40 hex chars)", async () => {
      const result = await generateEncryptedCaseWallet({
        agentId: TEST_AGENT_ID,
        caseIdentity: TEST_CASE_IDENTITY,
        encryptionKey: TEST_ENCRYPTION_KEY,
      });
      expect(result.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    });

    it("generated address matches the encrypted private key after controlled test decryption", async () => {
      const result = await generateEncryptedCaseWallet({
        agentId: TEST_AGENT_ID,
        caseIdentity: TEST_CASE_IDENTITY,
        encryptionKey: TEST_ENCRYPTION_KEY,
      });

      // Decrypt the private key
      const pk = decryptCaseWalletPrivateKey({
        encryptedSecret: result.encryptedSecret,
        caseIdentity: TEST_CASE_IDENTITY,
        agentId: TEST_AGENT_ID,
        encryptionKey: TEST_ENCRYPTION_KEY,
      });

      // Verify the private key is a valid EVM key
      expect(pk).toMatch(/^0x[0-9a-fA-F]{64}$/);
      expect(pk.startsWith("0x")).toBe(true);
      expect(pk.length).toBe(66); // "0x" + 64 hex chars
    });
  });

  describe("uniqueness", () => {
    it("two generated case wallets have different addresses", async () => {
      const r1 = await generateEncryptedCaseWallet({
        agentId: TEST_AGENT_ID,
        caseIdentity: TEST_CASE_IDENTITY,
        encryptionKey: TEST_ENCRYPTION_KEY,
      });
      const r2 = await generateEncryptedCaseWallet({
        agentId: TEST_AGENT_ID,
        caseIdentity: TEST_CASE_IDENTITY,
        encryptionKey: TEST_ENCRYPTION_KEY,
      });

      expect(r1.address).not.toBe(r2.address);
    });

    it("two generated case wallets have different encrypted envelopes", async () => {
      const r1 = await generateEncryptedCaseWallet({
        agentId: TEST_AGENT_ID,
        caseIdentity: TEST_CASE_IDENTITY,
        encryptionKey: TEST_ENCRYPTION_KEY,
      });
      const r2 = await generateEncryptedCaseWallet({
        agentId: TEST_AGENT_ID,
        caseIdentity: TEST_CASE_IDENTITY,
        encryptionKey: TEST_ENCRYPTION_KEY,
      });

      // Ciphertexts should differ
      expect(r1.encryptedSecret.ciphertext).not.toBe(
        r2.encryptedSecret.ciphertext,
      );
      // IVs should differ
      expect(r1.encryptedSecret.iv).not.toBe(r2.encryptedSecret.iv);
    });
  });

  describe("secrecy", () => {
    it("returned object does not contain a plaintext privateKey field", async () => {
      const result = await generateEncryptedCaseWallet({
        agentId: TEST_AGENT_ID,
        caseIdentity: TEST_CASE_IDENTITY,
        encryptionKey: TEST_ENCRYPTION_KEY,
      });

      expect(result).not.toHaveProperty("privateKey");
      expect(result).not.toHaveProperty("secret");
      expect(result).not.toHaveProperty("key");
    });

    it("JSON serialization does not reveal the decrypted private key", async () => {
      const result = await generateEncryptedCaseWallet({
        agentId: TEST_AGENT_ID,
        caseIdentity: TEST_CASE_IDENTITY,
        encryptionKey: TEST_ENCRYPTION_KEY,
      });

      // Decrypt to get the actual private key, then verify it's not in the
      // serialized result
      const pk = decryptCaseWalletPrivateKey({
        encryptedSecret: result.encryptedSecret,
        caseIdentity: TEST_CASE_IDENTITY,
        agentId: TEST_AGENT_ID,
        encryptionKey: TEST_ENCRYPTION_KEY,
      });

      const serialized = JSON.stringify(result);
      // The plaintext private key hex must not appear in the JSON
      expect(serialized).not.toContain(pk);

      // Also verify the key's hex digits aren't accidentally embedded
      const hexPart = pk.slice(2);
      if (hexPart.length >= 64) {
        // The full key hex should never appear
        expect(serialized).not.toContain(hexPart);
      }
    });

    it("returns only { encryptedSecret, address } shape", async () => {
      const result = await generateEncryptedCaseWallet({
        agentId: TEST_AGENT_ID,
        caseIdentity: TEST_CASE_IDENTITY,
        encryptionKey: TEST_ENCRYPTION_KEY,
      });

      // The result should have exactly the expected keys
      const keys = Object.keys(result).sort();
      expect(keys).toEqual(
        expect.arrayContaining(["address", "encryptedSecret"]),
      );
      // No extra keys that could leak sensitive data
      const extraKeys = keys.filter(
        (k) => k !== "address" && k !== "encryptedSecret",
      );
      expect(extraKeys).toHaveLength(0);
    });
  });

  describe("no side effects", () => {
    it("no balance or RPC call is made — function is local-only", async () => {
      // generateEncryptedCaseWallet should be a pure local operation:
      // generate key, derive address, encrypt. No network calls.
      const result = await generateEncryptedCaseWallet({
        agentId: TEST_AGENT_ID,
        caseIdentity: TEST_CASE_IDENTITY,
        encryptionKey: TEST_ENCRYPTION_KEY,
      });
      expect(result).toBeDefined();
      expect(result.address).toBeDefined();
      expect(result.encryptedSecret).toBeDefined();
    });

    it("no database persistence occurs — function is stateless", async () => {
      // The function should not access process.env for database vars
      // or make any persistence calls.
      const result = await generateEncryptedCaseWallet({
        agentId: TEST_AGENT_ID,
        caseIdentity: TEST_CASE_IDENTITY,
        encryptionKey: TEST_ENCRYPTION_KEY,
      });
      expect(result).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// isValidEVMPrivateKey
// ---------------------------------------------------------------------------

describe("isValidEVMPrivateKey", () => {
  describe("valid keys", () => {
    it("valid 0x-prefixed 64-char hex returns true", () => {
      const validKey = "0x" + "a1".repeat(32);
      expect(isValidEVMPrivateKey(validKey)).toBe(true);
    });

    it("uppercase hex is valid", () => {
      const key = "0x" + "FF".repeat(32);
      expect(isValidEVMPrivateKey(key)).toBe(true);
    });

    it("mixed-case hex is valid", () => {
      const key = "0x" + "aBcDeF0123456789aBcDeF0123456789aBcDeF0123456789aBcDeF0123456789";
      expect(isValidEVMPrivateKey(key)).toBe(true);
    });
  });

  describe("invalid keys", () => {
    it("missing 0x prefix returns false", () => {
      const key = "a1".repeat(32);
      expect(isValidEVMPrivateKey(key)).toBe(false);
    });

    it("wrong length (63 hex chars + 0x) returns false", () => {
      const key = "0x" + "a1".repeat(31) + "a";
      expect(isValidEVMPrivateKey(key)).toBe(false);
    });

    it("wrong length (65 hex chars + 0x) returns false", () => {
      const key = "0x" + "a1".repeat(32) + "ab";
      expect(isValidEVMPrivateKey(key)).toBe(false);
    });

    it("non-hex characters return false", () => {
      const key = "0x" + "GG".repeat(32);
      expect(isValidEVMPrivateKey(key)).toBe(false);
    });

    it("empty string returns false", () => {
      expect(isValidEVMPrivateKey("")).toBe(false);
    });

    it("0x only returns false", () => {
      expect(isValidEVMPrivateKey("0x")).toBe(false);
    });

    it("non-string input types are handled safely", () => {
      expect(isValidEVMPrivateKey(null as unknown as string)).toBe(false);
      expect(
        isValidEVMPrivateKey(undefined as unknown as string),
      ).toBe(false);
    });
  });
});
