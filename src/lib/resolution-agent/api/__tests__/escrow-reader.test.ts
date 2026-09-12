// ---------------------------------------------------------------------------
// Resolution Agent API — Escrow Case Reader Tests
//
// Validates the escrow case reader implementations: canonical constants,
// MockEscrowCaseReader behaviour, CeloSepoliaEscrowCaseReader structure,
// and the CaseParties type shape.
//
// NOTE: getCaseParties accepts an object { escrowPaymentId: string } to
// match the service layer's API.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  CANONICAL_ESCROW_CHAIN_ID,
  CANONICAL_ESCROW_CONTRACT_ADDRESS,
  MockEscrowCaseReader,
  CeloEscrowCaseReader,
  CeloSepoliaEscrowCaseReader,
  type CaseParties,
} from "../escrow-reader";

// ---------------------------------------------------------------------------
// Canonical constants
// ---------------------------------------------------------------------------

describe("CANONICAL_ESCROW_CHAIN_ID", () => {
  it("is 11142220 (Celo Sepolia / Alfajores)", () => {
    expect(CANONICAL_ESCROW_CHAIN_ID).toBe(11142220);
  });
});

describe("CANONICAL_ESCROW_CONTRACT_ADDRESS", () => {
  it("is the canonical V2 address 0x1A1CA38D6ac538d491A5c0db2Ed7FDDC3AeC709F", () => {
    expect(CANONICAL_ESCROW_CONTRACT_ADDRESS.toLowerCase()).toBe(
      "0x1a1ca38d6ac538d491a5c0db2ed7fddc3aec709f",
    );
  });
});

// ---------------------------------------------------------------------------
// MockEscrowCaseReader
// ---------------------------------------------------------------------------

describe("MockEscrowCaseReader", () => {
  it("returns configured case parties for known paymentId", async () => {
    const reader = new MockEscrowCaseReader();
    reader.setCaseParties("pay_test_001", {
      client: "0xCLIENT_CLIENT_CLIENT_CLIENT_CLIENT_CLIENT_CLIENT",
      worker: "0xWORKER_WORKER_WORKER_WORKER_WORKER_WORKER_WORKER",
      exists: true,
    });

    const result = await reader.getCaseParties({
      escrowPaymentId: "pay_test_001",
    });
    expect(result.client.toLowerCase()).toBe(
      "0xclient_client_client_client_client_client_client",
    );
    expect(result.worker.toLowerCase()).toBe(
      "0xworker_worker_worker_worker_worker_worker_worker",
    );
    expect(result.exists).toBe(true);
  });

  it("returns exists:false for unknown paymentId", async () => {
    const reader = new MockEscrowCaseReader();
    const result = await reader.getCaseParties({
      escrowPaymentId: "nonexistent_payment",
    });
    expect(result.exists).toBe(false);
    expect(result.client).toBe("0x0000000000000000000000000000000000000000");
    expect(result.worker).toBe("0x0000000000000000000000000000000000000000");
  });

  it("is case-insensitive for paymentId lookup", async () => {
    const reader = new MockEscrowCaseReader();
    reader.setCaseParties("PAY_UPPER_CASE", {
      client: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      worker: "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      exists: true,
    });

    const result = await reader.getCaseParties({
      escrowPaymentId: "pay_upper_case",
    });
    expect(result.exists).toBe(true);
    expect(result.client.toLowerCase()).toBe(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
  });

  it("can be updated with setCaseParties (overwrites previous)", async () => {
    const reader = new MockEscrowCaseReader();
    reader.setCaseParties("pay_mutable", {
      client: "0x1111111111111111111111111111111111111111",
      worker: "0x2222222222222222222222222222222222222222",
      exists: true,
    });

    // Overwrite
    reader.setCaseParties("pay_mutable", {
      client: "0x3333333333333333333333333333333333333333",
      worker: "0x4444444444444444444444444444444444444444",
      exists: true,
    });

    const result = await reader.getCaseParties({
      escrowPaymentId: "pay_mutable",
    });
    expect(result.client.toLowerCase()).toBe(
      "0x3333333333333333333333333333333333333333",
    );
    expect(result.worker.toLowerCase()).toBe(
      "0x4444444444444444444444444444444444444444",
    );
  });

  it("makes no live RPC call (resolves instantly)", async () => {
    const reader = new MockEscrowCaseReader();
    reader.setCaseParties("pay_rpc_test", {
      client: "0x5555555555555555555555555555555555555555",
      worker: "0x6666666666666666666666666666666666666666",
      exists: true,
    });

    const start = performance.now();
    const result = await reader.getCaseParties({
      escrowPaymentId: "pay_rpc_test",
    });
    const elapsed = performance.now() - start;

    expect(result.exists).toBe(true);
    expect(elapsed).toBeLessThan(50);
  });
});

// ---------------------------------------------------------------------------
// CeloSepoliaEscrowCaseReader
// ---------------------------------------------------------------------------

describe("CeloSepoliaEscrowCaseReader", () => {
  it("constructor accepts optional RPC URL", () => {
    const reader = new CeloSepoliaEscrowCaseReader(
      "https://custom-rpc.example.com",
    );
    expect(reader).toBeDefined();
  });

  it("default constructor creates a valid instance", () => {
    const reader = new CeloSepoliaEscrowCaseReader();
    expect(reader).toBeDefined();
  });

  it("uses chain 11142220", () => {
    const reader = new CeloSepoliaEscrowCaseReader();
    expect(reader.chainId).toBe(11142220);
  });

  it("uses the canonical escrow contract address", () => {
    const reader = new CeloSepoliaEscrowCaseReader();
    expect(reader.contractAddress.toLowerCase()).toBe(
      CANONICAL_ESCROW_CONTRACT_ADDRESS.toLowerCase(),
    );
  });

  it("getCaseParties returns Promise<CaseParties>", () => {
    const reader = new CeloSepoliaEscrowCaseReader();
    const result = reader.getCaseParties({
      escrowPaymentId: "pay_any",
    });
    expect(result).toBeInstanceOf(Promise);
    // Clean up the promise (will likely reject due to no live RPC)
    result.catch(() => {});
  });

  it("getCaseParties accepts 1 argument (caseIdentity object)", () => {
    const reader = new CeloSepoliaEscrowCaseReader();
    expect(reader.getCaseParties.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Chain-aware reader
// ---------------------------------------------------------------------------

describe("CeloEscrowCaseReader", () => {
  it("uses the selected Sepolia chain and address", () => {
    const reader = new CeloEscrowCaseReader(11142220);
    expect(reader.chainId).toBe(11142220);
    expect(reader.contractAddress).toBe(CANONICAL_ESCROW_CONTRACT_ADDRESS);
  });

  it("fails closed for mainnet until its escrow address is configured", () => {
    expect(() => new CeloEscrowCaseReader(42220)).toThrow(
      /not deployed on chain 42220/i,
    );
  });
});

// ---------------------------------------------------------------------------
// CaseParties type shape
// ---------------------------------------------------------------------------

describe("CaseParties type", () => {
  it("has client field", () => {
    const parties: CaseParties = {
      client: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      worker: "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      exists: true,
    };
    expect(parties).toHaveProperty("client");
    expect(typeof parties.client).toBe("string");
    expect(parties.client).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("has worker field", () => {
    const parties: CaseParties = {
      client: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      worker: "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      exists: true,
    };
    expect(parties).toHaveProperty("worker");
    expect(typeof parties.worker).toBe("string");
    expect(parties.worker).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("has exists field (boolean)", () => {
    const parties: CaseParties = {
      client: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      worker: "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      exists: false,
    };
    expect(parties).toHaveProperty("exists");
    expect(typeof parties.exists).toBe("boolean");
  });
});
