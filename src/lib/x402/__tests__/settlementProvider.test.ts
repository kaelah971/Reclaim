// ---------------------------------------------------------------------------
// Unit tests: x402 settlement provider abstraction
//
// Tests the X402SettlementProvider interface, the getSettlementProvider()
// factory, and both concrete implementations (LocalSettlementProvider and
// CeloFacilitatorSettlementProvider).
//
// No real network calls — focuses on the abstraction layer: mode selection,
// identity fields, type shapes, and error-representation patterns.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock the config module so we can control X402_SETTLEMENT_MODE dynamically.
//
// config.ts reads process.env.X402_SETTLEMENT_MODE at module import time
// and exports it as a const.  vi.mock is hoisted above all imports, so we
// replace the const with a getter that reads from a mutable ref.  All other
// config values (X402_NETWORK, X402_PAY_TO_ADDRESS, etc.) are preserved
// from the original module via importOriginal.
// ---------------------------------------------------------------------------

const modeRef = vi.hoisted(() => ({ current: "local" as string }));

vi.mock("../config", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actual: any = await importOriginal();
  return {
    ...actual,
    get X402_SETTLEMENT_MODE() {
      return modeRef.current;
    },
  };
});

// ---------------------------------------------------------------------------
// Imports — vi.mock is hoisted so the mock is already in place.
// ---------------------------------------------------------------------------

import { getSettlementProvider } from "../settlementProvider";
import { LocalSettlementProvider } from "../settlementProvider.local";
import { CeloFacilitatorSettlementProvider } from "../settlementProvider.facilitator";
import type {
  X402SettlementProvider,
  VerifyResult,
  SettleResult,
  FacilitatorSettlementReceipt,
} from "../settlementProvider";
import {
  X402_NETWORK,
  X402_PAY_TO_ADDRESS,
  X402_FACILITATOR_NETWORK,
  X402_PAY_TO_ADDRESS_FACILITATOR,
} from "../config";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Known Track 2 wallet on Celo mainnet (hardcoded default in config.ts). */
const TRACK2_WALLET = "0x85522bdE267d05bf8CE8813F97c75417b7894A33";

/** URL of the official Celo x402 facilitator. */
const FACILITATOR_URL = "https://api.x402.celo.org";

/** Valid txhash shape (66 chars: 0x + 64 hex). */
const VALID_TXHASH =
  "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";

// ---------------------------------------------------------------------------
// Reset the mocked settlement mode before each test.
// ---------------------------------------------------------------------------

beforeEach(() => {
  modeRef.current = "local";
});

// ===========================================================================
// 1. Provider Selection (factory)
// ===========================================================================

describe("getSettlementProvider (factory)", () => {
  it("returns LocalSettlementProvider by default (no env var set)", () => {
    // modeRef.current defaults to "local" via beforeEach
    const provider = getSettlementProvider();
    expect(provider).toBeInstanceOf(LocalSettlementProvider);
    expect(provider.identifier).toBe("local");
  });

  it("returns CeloFacilitatorSettlementProvider when mode is celo-facilitator", () => {
    modeRef.current = "celo-facilitator";
    const provider = getSettlementProvider();
    expect(provider).toBeInstanceOf(CeloFacilitatorSettlementProvider);
    expect(provider.identifier).toBe("celo-facilitator");
  });

  it("returns LocalSettlementProvider when mode is explicitly local", () => {
    modeRef.current = "local";
    const provider = getSettlementProvider();
    expect(provider).toBeInstanceOf(LocalSettlementProvider);
    expect(provider.identifier).toBe("local");
  });

  it("throws when mode is unrecognized", () => {
    modeRef.current = "mainnet-gateway"; // unknown mode
    expect(() => getSettlementProvider()).toThrow(
      'Unknown X402_SETTLEMENT_MODE: "mainnet-gateway"',
    );
  });

  it("throws with message listing expected modes", () => {
    modeRef.current = "bogus";
    expect(() => getSettlementProvider()).toThrow(/Expected "local" or "celo-facilitator"/);
  });

  it("is idempotent — same mode always returns the same implementation type", () => {
    modeRef.current = "celo-facilitator";
    const a = getSettlementProvider();
    const b = getSettlementProvider();
    expect(a).toBeInstanceOf(CeloFacilitatorSettlementProvider);
    expect(b).toBeInstanceOf(CeloFacilitatorSettlementProvider);
    // Each call creates a new instance (factory semantics).
    expect(a).not.toBe(b);
  });

  it("changing mode between calls returns different implementations", () => {
    modeRef.current = "local";
    const local = getSettlementProvider();
    expect(local.identifier).toBe("local");

    modeRef.current = "celo-facilitator";
    const facilitator = getSettlementProvider();
    expect(facilitator.identifier).toBe("celo-facilitator");
  });
});

// ===========================================================================
// 2. LocalSettlementProvider identity fields
// ===========================================================================

describe("LocalSettlementProvider", () => {
  let provider: LocalSettlementProvider;

  beforeEach(() => {
    provider = new LocalSettlementProvider();
  });

  it("has identifier 'local'", () => {
    expect(provider.identifier).toBe("local");
  });

  it("has network 'eip155:11142220' (Celo Sepolia)", () => {
    expect(provider.network).toBe(X402_NETWORK);
    expect(provider.network).toBe("eip155:11142220");
  });

  it("isTrack2Qualifying is false", () => {
    expect(provider.isTrack2Qualifying).toBe(false);
  });

  it("payToAddress matches the configured X402_PAY_TO_ADDRESS", () => {
    // In test env, X402_PAY_TO_ADDRESS is set by vitest.config.ts
    expect(provider.payToAddress).toBe(X402_PAY_TO_ADDRESS);
    // Must be a valid hex address
    expect(provider.payToAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  it("implements the full X402SettlementProvider interface", () => {
    const p: X402SettlementProvider = provider;
    expect(p.identifier).toBeDefined();
    expect(p.network).toBeDefined();
    expect(p.payToAddress).toBeDefined();
    expect(typeof p.isTrack2Qualifying).toBe("boolean");
    expect(typeof p.verifyPayment).toBe("function");
    expect(typeof p.settlePayment).toBe("function");
  });
});

// ===========================================================================
// 3. CeloFacilitatorSettlementProvider identity fields
// ===========================================================================

describe("CeloFacilitatorSettlementProvider", () => {
  let provider: CeloFacilitatorSettlementProvider;

  beforeEach(() => {
    provider = new CeloFacilitatorSettlementProvider();
  });

  it("has identifier 'celo-facilitator'", () => {
    expect(provider.identifier).toBe("celo-facilitator");
  });

  it("has network 'eip155:42220' (Celo mainnet)", () => {
    expect(provider.network).toBe(X402_FACILITATOR_NETWORK);
    expect(provider.network).toBe("eip155:42220");
  });

  it("isTrack2Qualifying is true", () => {
    expect(provider.isTrack2Qualifying).toBe(true);
  });

  it("payToAddress is the registered Track 2 wallet", () => {
    expect(provider.payToAddress).toBe(X402_PAY_TO_ADDRESS_FACILITATOR);
    expect(provider.payToAddress).toBe(TRACK2_WALLET);
    expect(provider.payToAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  it("implements the full X402SettlementProvider interface", () => {
    const p: X402SettlementProvider = provider;
    expect(p.identifier).toBeDefined();
    expect(p.network).toBeDefined();
    expect(p.payToAddress).toBeDefined();
    expect(typeof p.isTrack2Qualifying).toBe("boolean");
    expect(typeof p.verifyPayment).toBe("function");
    expect(typeof p.settlePayment).toBe("function");
  });

  // -----------------------------------------------------------------------
  // buildMainnetRequirements static helper
  // -----------------------------------------------------------------------

  describe("buildMainnetRequirements", () => {
    it("returns requirements for the Celo mainnet facilitator", () => {
      const reqs = CeloFacilitatorSettlementProvider.buildMainnetRequirements(
        "10000",
      );

      expect(reqs.scheme).toBe("exact");
      expect(reqs.network).toBe("eip155:42220");
      expect(reqs.amount).toBe("10000");
      expect(reqs.payTo).toBe(TRACK2_WALLET);
      expect(reqs.maxTimeoutSeconds).toBe(300);
    });

    it("accepts a custom maxTimeoutSeconds", () => {
      const reqs = CeloFacilitatorSettlementProvider.buildMainnetRequirements(
        "50000",
        120,
      );

      expect(reqs.amount).toBe("50000");
      expect(reqs.maxTimeoutSeconds).toBe(120);
    });
  });

  // -----------------------------------------------------------------------
  // buildPaymentPayload static helper
  // -----------------------------------------------------------------------

  describe("buildPaymentPayload", () => {
    it("wraps raw payment details in a PaymentPayload envelope", () => {
      const rawPayment = { signature: "0xab", nonce: "1" };
      const requirements =
        CeloFacilitatorSettlementProvider.buildMainnetRequirements("10000");

      const payload = CeloFacilitatorSettlementProvider.buildPaymentPayload(
        rawPayment,
        requirements,
      );

      expect(payload.x402Version).toBe(2);
      expect(payload.accepted).toBe(requirements);
      expect(payload.payload).toBe(rawPayment);
    });
  });
});

// ===========================================================================
// 4. No silent fallback
// ===========================================================================

describe("No silent fallback", () => {
  it("LocalSettlementProvider does not expose a facilitator URL", () => {
    const local = new LocalSettlementProvider();
    // The local provider has no facilitatorUrl — it settles directly on-chain.
    expect("facilitatorUrl" in local).toBe(false);
  });

  it("CeloFacilitatorSettlementProvider does not expose a relayer private key", () => {
    const facilitator = new CeloFacilitatorSettlementProvider();
    // The facilitator provider has no relayer key dependency — the facilitator
    // broadcasts the settlement transaction.
    expect("relayerPrivateKey" in facilitator).toBe(false);
  });

  it("each provider has distinct, purpose-specific identifiers", () => {
    const local = new LocalSettlementProvider();
    const facilitator = new CeloFacilitatorSettlementProvider();

    expect(local.identifier).not.toBe(facilitator.identifier);
    expect(local.network).not.toBe(facilitator.network);
    expect(local.isTrack2Qualifying).not.toBe(facilitator.isTrack2Qualifying);
  });

  it("Track 2 provider flags are mutually exclusive", () => {
    const local = new LocalSettlementProvider();
    const facilitator = new CeloFacilitatorSettlementProvider();

    // Exactly one provider is Track 2 qualifying.
    expect(local.isTrack2Qualifying).toBe(false);
    expect(facilitator.isTrack2Qualifying).toBe(true);
  });

  it("factory throws on unknown mode — never silently falls back", () => {
    modeRef.current = "nonexistent";
    expect(() => getSettlementProvider()).toThrow(
      /Unknown X402_SETTLEMENT_MODE/,
    );
  });

  it("VerifyResult models failure without a fallback path", () => {
    // The VerifyResult type has `valid: false` and `reason` — callers must
    // check validity; there is no "maybe" or silent-fallback state.
    const failure: VerifyResult = { valid: false, reason: "Network mismatch" };
    expect(failure.valid).toBe(false);
    expect(failure.reason).toBe("Network mismatch");
    expect(failure.payer).toBeUndefined();
  });

  it("SettleResult models failure explicitly — callers must branch on success", () => {
    const failure: SettleResult = {
      success: false,
      reason: "Settlement reverted on-chain",
    };
    expect(failure.success).toBe(false);
    expect(failure.reason).toBe("Settlement reverted on-chain");
    expect(failure.txHash).toBeUndefined();
    expect(failure.receipt).toBeUndefined();
  });
});

// ===========================================================================
// 5. Facilitator receipt shape
// ===========================================================================

describe("FacilitatorSettlementReceipt", () => {
  /** Build a valid, minimal facilitator receipt for type assertions. */
  function buildFacilitatorReceipt(
    overrides?: Partial<FacilitatorSettlementReceipt>,
  ): FacilitatorSettlementReceipt {
    return {
      facilitatorUrl: FACILITATOR_URL,
      x402Version: 2,
      scheme: "exact",
      network: "eip155:42220",
      payer: "0x1111111111111111111111111111111111111111",
      payTo: TRACK2_WALLET,
      token: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
      amount: "10000",
      paymentIdentifier: "pay_abc123",
      settlementTxHash: VALID_TXHASH,
      settlementSuccess: true,
      blockNumber: 12345678,
      settledAt: "2026-07-27T12:00:00.000Z",
      ...overrides,
    };
  }

  it("has all required fields", () => {
    const receipt = buildFacilitatorReceipt();

    expect(receipt.facilitatorUrl).toBe(FACILITATOR_URL);
    expect(receipt.x402Version).toBe(2);
    expect(receipt.scheme).toBe("exact");
    expect(receipt.network).toBe("eip155:42220");
    expect(receipt.payer).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(receipt.payTo).toBe(TRACK2_WALLET);
    expect(receipt.token).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(receipt.amount).toBe("10000");
    expect(receipt.paymentIdentifier).toBeTruthy();
    expect(receipt.settlementTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    expect(receipt.settlementSuccess).toBe(true);
    expect(receipt.settledAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("amount is stored as a string (JSON-safe, no BigInt)", () => {
    const receipt = buildFacilitatorReceipt({ amount: "1000000000" });

    // Must be a string — BigInt is not JSON-serialisable.
    expect(typeof receipt.amount).toBe("string");
    expect(receipt.amount).toBe("1000000000");

    // The receipt itself must survive JSON round-trip.
    const json = JSON.stringify(receipt);
    const parsed = JSON.parse(json) as FacilitatorSettlementReceipt;
    expect(parsed.amount).toBe("1000000000");
  });

  it("contains no secrets (no private keys, API tokens, signatures)", () => {
    const receipt = buildFacilitatorReceipt();
    const json = JSON.stringify(receipt).toLowerCase();

    // These patterns must never appear in a receipt.
    const forbidden = [
      "privatekey",
      "private_key",
      "api_key",
      "apikey",
      "secret",
      "bearer",
      "password",
    ];
    for (const secret of forbidden) {
      expect(json).not.toContain(secret);
    }
  });

  it("blockNumber is optional and may be undefined", () => {
    const withoutBlock = buildFacilitatorReceipt({ blockNumber: undefined });
    expect(withoutBlock.blockNumber).toBeUndefined();
  });

  it("settlementSuccess can be false for failed settlements", () => {
    const failed = buildFacilitatorReceipt({
      settlementSuccess: false,
      settlementTxHash: "",
    });
    expect(failed.settlementSuccess).toBe(false);
  });
});

// ===========================================================================
// 6. Settlement result types
// ===========================================================================

describe("SettleResult", () => {
  it("success result contains txHash", () => {
    const result: SettleResult = {
      success: true,
      txHash: VALID_TXHASH,
      blockNumber: 12345678,
    };

    expect(result.success).toBe(true);
    expect(result.txHash).toBe(VALID_TXHASH);
    expect(result.blockNumber).toBe(12345678);
    expect(result.reason).toBeUndefined();
  });

  it("failure result contains reason", () => {
    const result: SettleResult = {
      success: false,
      reason: "Settlement transaction reverted on-chain",
    };

    expect(result.success).toBe(false);
    expect(result.reason).toBe("Settlement transaction reverted on-chain");
    expect(result.txHash).toBeUndefined();
  });

  it("receipt field is only populated in facilitator mode", () => {
    const withReceipt: SettleResult = {
      success: true,
      txHash: VALID_TXHASH,
      receipt: {
        facilitatorUrl: FACILITATOR_URL,
        x402Version: 2,
        scheme: "exact",
        network: "eip155:42220",
        payer: "0x1111111111111111111111111111111111111111",
        payTo: TRACK2_WALLET,
        token: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
        amount: "10000",
        paymentIdentifier: "pay_abc123",
        settlementTxHash: VALID_TXHASH,
        settlementSuccess: true,
        settledAt: "2026-07-27T12:00:00.000Z",
      },
    };

    expect(withReceipt.receipt).toBeDefined();
    expect(withReceipt.receipt!.facilitatorUrl).toBe(FACILITATOR_URL);
    expect(withReceipt.receipt!.network).toBe("eip155:42220");
  });

  it("receipt is undefined in local mode success", () => {
    const localResult: SettleResult = {
      success: true,
      txHash: VALID_TXHASH,
      blockNumber: 12345678,
    };

    expect(localResult.success).toBe(true);
    expect(localResult.receipt).toBeUndefined();
  });

  it("SettleResult is JSON-safe (no BigInt, all fields serialisable)", () => {
    const result: SettleResult = {
      success: true,
      txHash: VALID_TXHASH,
      blockNumber: 12345678,
    };

    const json = JSON.stringify(result);
    const parsed = JSON.parse(json) as SettleResult;
    expect(parsed.success).toBe(true);
    expect(parsed.txHash).toBe(VALID_TXHASH);
    expect(parsed.blockNumber).toBe(12345678);
  });
});

// ===========================================================================
// 7. VerifyResult type correctness
// ===========================================================================

describe("VerifyResult", () => {
  it("valid result includes payer address", () => {
    const result: VerifyResult = {
      valid: true,
      payer: "0x1111111111111111111111111111111111111111",
    };

    expect(result.valid).toBe(true);
    expect(result.payer).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(result.reason).toBeUndefined();
  });

  it("invalid result includes reason and no payer", () => {
    const result: VerifyResult = {
      valid: false,
      reason: "Permit2 signature invalid",
    };

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Permit2 signature invalid");
  });

  it("invalid result may still include payer for auditability", () => {
    const result: VerifyResult = {
      valid: false,
      reason: "Insufficient USDC balance",
      payer: "0x2222222222222222222222222222222222222222",
    };

    expect(result.valid).toBe(false);
    expect(result.payer).toBe("0x2222222222222222222222222222222222222222");
    expect(result.reason).toBe("Insufficient USDC balance");
  });
});

// ===========================================================================
// 8. Environment-dependent behavior
// ===========================================================================

describe("Environment-dependent behavior", () => {
  it("mode='celo-facilitator' selects CeloFacilitatorSettlementProvider", () => {
    modeRef.current = "celo-facilitator";
    const provider = getSettlementProvider();

    expect(provider).toBeInstanceOf(CeloFacilitatorSettlementProvider);
    expect(provider.identifier).toBe("celo-facilitator");
    expect(provider.network).toBe("eip155:42220");
    expect(provider.isTrack2Qualifying).toBe(true);
  });

  it("mode='local' selects LocalSettlementProvider", () => {
    modeRef.current = "local";
    const provider = getSettlementProvider();

    expect(provider).toBeInstanceOf(LocalSettlementProvider);
    expect(provider.identifier).toBe("local");
    expect(provider.network).toBe("eip155:11142220");
    expect(provider.isTrack2Qualifying).toBe(false);
  });

  it("missing / unset mode defaults to local", () => {
    // Simulate an empty/unset env var — config.ts falls back to "local".
    // Our mock default is "local" (set in beforeEach), which matches the
    // real behaviour when X402_SETTLEMENT_MODE is absent.
    const provider = getSettlementProvider();

    expect(provider).toBeInstanceOf(LocalSettlementProvider);
    expect(provider.identifier).toBe("local");
  });

  it("mode comparison is case-sensitive", () => {
    modeRef.current = "Celo-Facilitator"; // wrong case
    expect(() => getSettlementProvider()).toThrow(
      /Unknown X402_SETTLEMENT_MODE/,
    );
  });

  it("mode with leading/trailing whitespace is not trimmed (treated as unknown)", () => {
    modeRef.current = " celo-facilitator ";
    expect(() => getSettlementProvider()).toThrow(
      /Unknown X402_SETTLEMENT_MODE/,
    );
  });
});

// ===========================================================================
// 9. Config values are consistent between providers and direct imports
// ===========================================================================

describe("Config consistency", () => {
  it("X402_NETWORK matches LocalSettlementProvider network", () => {
    const local = new LocalSettlementProvider();
    expect(local.network).toBe(X402_NETWORK);
    expect(X402_NETWORK).toBe("eip155:11142220");
  });

  it("X402_FACILITATOR_NETWORK matches CeloFacilitatorSettlementProvider network", () => {
    const facilitator = new CeloFacilitatorSettlementProvider();
    expect(facilitator.network).toBe(X402_FACILITATOR_NETWORK);
    expect(X402_FACILITATOR_NETWORK).toBe("eip155:42220");
  });

  it("X402_PAY_TO_ADDRESS_FACILITATOR is the known Track 2 wallet", () => {
    expect(X402_PAY_TO_ADDRESS_FACILITATOR).toBe(TRACK2_WALLET);
  });

  it("payToAddress values differ between local and facilitator providers", () => {
    const local = new LocalSettlementProvider();
    const facilitator = new CeloFacilitatorSettlementProvider();

    // They serve different networks and wallets — must not be accidentally
    // pointing at the same address.
    expect(local.payToAddress).not.toBe(facilitator.payToAddress);
  });
});
