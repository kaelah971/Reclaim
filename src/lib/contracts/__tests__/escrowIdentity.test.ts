// ---------------------------------------------------------------------------
// P7.2 PART 1 — escrow identity + URL compat + ABI surface (pure, no network).
//
// Proves:
//   1. Mainnet no-escrow → V1 0xE42c… (legacy rule preserved)
//   2. Explicit Mainnet V1 → V1 entry
//   3. Fixture-injected future Mainnet V2 resolves (custom deployments map —
//      NEVER added to the prod allowlist; clearly-fake 0x fixtures)
//   4. Sepolia no-escrow → V1 0x1A1C… (canonical, unchanged)
//   5. Fixture-injected Sepolia V2 resolves
//   6. Unknown explicit escrow → throws (fail closed, no fallback)
//   7. buildPaymentSharePath preserves &escrow= for V2, omits for canonical V1
//   8. resolveRouteEscrow helper + cross-chain mismatch throws
//   + V2 ABI surface (executeAutoRelease / getAutoReleaseEligibility /
//     AutoReleased / autopilotEnabled / 11-param createPayment) vs V1 absence
//   + lowercase-vs-checksummed address equality
//   + buildEscrowQuery / isCanonicalDeployment URL compat
// No RPC calls, no transactions, no secrets.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import {
  buildEscrowQuery,
  DEFAULT_ESCROW_DEPLOYMENTS,
  getEscrowDeployment,
  isCanonicalDeployment,
  MAINNET_CANONICAL_V1,
  parseEscrowParam,
  pickEscrowParam,
  resolveRouteEscrow,
  SEPOLIA_CANONICAL_V1,
  SEPOLIA_HISTORICAL_V1,
  type EscrowDeployments,
} from "../escrowIdentity";
import { getEscrowDeploymentConfig } from "../config";
import { protectedPaymentEscrowABI } from "../ProtectedPaymentEscrow.abi";
import { protectedPaymentEscrowV2ABI } from "../ProtectedPaymentEscrowV2.abi";
import { buildPaymentSharePath } from "@/components/payment/SharePaymentLink";

const MAINNET = 42220;
const SEPOLIA = 11142220;
const PAYMENT_ID = "7";

// Clearly-fake fixture addresses (NEVER prod allowlist entries).
const FAKE_MAINNET_V2 = "0x3333333333333333333333333333333333333333" as const;
const FAKE_SEPOLIA_V2 = "0x2222222222222222222222222222222222222222" as const;
const FAKE_UNKNOWN = "0x9999999999999999999999999999999999999999" as const;

function deploymentsWithFutureV2(): EscrowDeployments {
  return {
    ...DEFAULT_ESCROW_DEPLOYMENTS,
    [MAINNET]: [
      ...DEFAULT_ESCROW_DEPLOYMENTS[MAINNET],
      {
        chainId: MAINNET,
        address: FAKE_MAINNET_V2 as `0x${string}`,
        contract: "ProtectedPaymentEscrowV2",
        version: "v2",
      },
    ],
    [SEPOLIA]: [
      ...DEFAULT_ESCROW_DEPLOYMENTS[SEPOLIA],
      {
        chainId: SEPOLIA,
        address: FAKE_SEPOLIA_V2 as `0x${string}`,
        contract: "ProtectedPaymentEscrowV2",
        version: "v2",
      },
    ],
  };
}

describe("escrowIdentity — Case 1: Mainnet no-escrow resolves legacy V1", () => {
  it("returns V1 0xE42c… for {42220} with no escrow", () => {
    const deployment = getEscrowDeployment({ chainId: MAINNET });
    expect(deployment.address).toBe(MAINNET_CANONICAL_V1);
    expect(deployment.contract).toBe("ProtectedPaymentEscrow");
    expect(deployment.version).toBe("v1");
    expect(deployment.chainId).toBe(MAINNET);
  });
});

describe("escrowIdentity — Case 2: explicit Mainnet V1", () => {
  it("returns the V1 entry for the explicit canonical address", () => {
    const deployment = getEscrowDeployment({
      chainId: MAINNET,
      escrowAddress: MAINNET_CANONICAL_V1,
    });
    expect(deployment.address).toBe(MAINNET_CANONICAL_V1);
    expect(deployment.contract).toBe("ProtectedPaymentEscrow");
  });
});

describe("escrowIdentity — Case 3: fixture-injected future Mainnet V2", () => {
  it("resolves the injected V2 entry by address (fixture map only)", () => {
    const fixture = deploymentsWithFutureV2();
    const deployment = getEscrowDeployment(
      { chainId: MAINNET, escrowAddress: FAKE_MAINNET_V2 },
      fixture,
    );
    expect(deployment.address).toBe(FAKE_MAINNET_V2);
    expect(deployment.contract).toBe("ProtectedPaymentEscrowV2");
    expect(deployment.version).toBe("v2");
  });

  it("resolves the injected V2 by version without address", () => {
    const fixture = deploymentsWithFutureV2();
    const deployment = getEscrowDeployment(
      { chainId: MAINNET, version: "v2" },
      fixture,
    );
    expect(deployment.address).toBe(FAKE_MAINNET_V2);
  });

  it("prod allowlist has no V2 on Mainnet (version v2 throws)", () => {
    expect(() =>
      getEscrowDeployment({ chainId: MAINNET, version: "v2" }),
    ).toThrow(/version v2/);
  });
});

describe("escrowIdentity — Case 4: Sepolia no-escrow resolves canonical V1", () => {
  it("returns V1 0x1A1C… for {11142220} with no escrow (unchanged)", () => {
    const deployment = getEscrowDeployment({ chainId: SEPOLIA });
    expect(deployment.address).toBe(SEPOLIA_CANONICAL_V1);
    expect(deployment.contract).toBe("ProtectedPaymentEscrow");
    expect(deployment.version).toBe("v1");
  });

  it("resolves the historical V1 entry when explicitly given", () => {
    const deployment = getEscrowDeployment({
      chainId: SEPOLIA,
      escrowAddress: SEPOLIA_HISTORICAL_V1,
    });
    expect(deployment.address).toBe(SEPOLIA_HISTORICAL_V1);
    expect(deployment.version).toBe("v1");
  });
});

describe("escrowIdentity — Case 5: fixture-injected Sepolia V2", () => {
  it("resolves the injected Sepolia V2 entry", () => {
    const fixture = deploymentsWithFutureV2();
    const deployment = getEscrowDeployment(
      { chainId: SEPOLIA, escrowAddress: FAKE_SEPOLIA_V2 },
      fixture,
    );
    expect(deployment.contract).toBe("ProtectedPaymentEscrowV2");
    expect(deployment.version).toBe("v2");
  });
});

describe("escrowIdentity — Case 6: unknown escrow fails closed", () => {
  it("throws Unknown escrow contract (no fallback) on both chains", () => {
    for (const chainId of [MAINNET, SEPOLIA]) {
      expect(() =>
        getEscrowDeployment({ chainId, escrowAddress: FAKE_UNKNOWN }),
      ).toThrow(/Unknown escrow contract/);
    }
  });

  it("throws on malformed explicit escrow", () => {
    expect(() =>
      getEscrowDeployment({ chainId: MAINNET, escrowAddress: "0x123" }),
    ).toThrow(/Unknown escrow contract/);
    expect(() =>
      getEscrowDeployment({ chainId: MAINNET, escrowAddress: "not-an-address" }),
    ).toThrow(/Unknown escrow contract/);
  });

  it("throws on unsupported chains (no silent fallback)", () => {
    expect(() => getEscrowDeployment({ chainId: 1 })).toThrow(
      /Unsupported escrow chain/,
    );
    expect(() =>
      getEscrowDeployment({ chainId: 1, escrowAddress: FAKE_UNKNOWN }),
    ).toThrow(/Unsupported escrow chain/);
  });

  it("throws when address + version disagree", () => {
    const fixture = deploymentsWithFutureV2();
    expect(() =>
      getEscrowDeployment(
        { chainId: MAINNET, escrowAddress: MAINNET_CANONICAL_V1, version: "v2" },
        fixture,
      ),
    ).toThrow(/Unknown escrow contract/);
  });
});

describe("escrowIdentity — Case 7: share-path URL compat", () => {
  it("omits &escrow= for canonical V1 (legacy links byte-identical)", () => {
    expect(buildPaymentSharePath(PAYMENT_ID, MAINNET)).toBe(
      `/payments/${PAYMENT_ID}?chainId=${MAINNET}`,
    );
    expect(buildPaymentSharePath(PAYMENT_ID, SEPOLIA)).toBe(
      `/payments/${PAYMENT_ID}?chainId=${SEPOLIA}`,
    );
  });

  it("preserves &escrow= for explicit V2/non-canonical escrow", () => {
    expect(
      buildPaymentSharePath(PAYMENT_ID, MAINNET, FAKE_MAINNET_V2),
    ).toBe(`/payments/${PAYMENT_ID}?chainId=${MAINNET}&escrow=${FAKE_MAINNET_V2}`);
    expect(
      buildPaymentSharePath(PAYMENT_ID, SEPOLIA, SEPOLIA_HISTORICAL_V1),
    ).toBe(
      `/payments/${PAYMENT_ID}?chainId=${SEPOLIA}&escrow=${SEPOLIA_HISTORICAL_V1}`,
    );
  });

  it("fails closed (null) on malformed escrow", () => {
    expect(buildPaymentSharePath(PAYMENT_ID, MAINNET, "0x123")).toBeNull();
    expect(buildPaymentSharePath(PAYMENT_ID, MAINNET, "nope")).toBeNull();
  });
});

describe("escrowIdentity — Case 8: resolveRouteEscrow helper", () => {
  it("returns canonical when escrow is absent (null/undefined/empty)", () => {
    expect(resolveRouteEscrow(MAINNET, null).address).toBe(MAINNET_CANONICAL_V1);
    expect(resolveRouteEscrow(MAINNET, undefined).address).toBe(
      MAINNET_CANONICAL_V1,
    );
    expect(resolveRouteEscrow(SEPOLIA, "").address).toBe(SEPOLIA_CANONICAL_V1);
  });

  it("returns the allowlisted entry for explicit escrow", () => {
    expect(resolveRouteEscrow(SEPOLIA, SEPOLIA_HISTORICAL_V1).address).toBe(
      SEPOLIA_HISTORICAL_V1,
    );
  });

  it("throws when the address is valid on Sepolia but requested with 42220", () => {
    expect(() =>
      resolveRouteEscrow(MAINNET, SEPOLIA_CANONICAL_V1),
    ).toThrow(/Unknown escrow contract/);
    expect(() =>
      resolveRouteEscrow(SEPOLIA, MAINNET_CANONICAL_V1),
    ).toThrow(/Unknown escrow contract/);
  });

  it("throws on unknown escrow (no fallback)", () => {
    expect(() => resolveRouteEscrow(MAINNET, FAKE_UNKNOWN)).toThrow(
      /Unknown escrow contract/,
    );
  });
});

describe("escrowIdentity — URL query compat (buildEscrowQuery)", () => {
  it("serializes canonical V1 to ?chainId=X only", () => {
    expect(
      buildEscrowQuery(getEscrowDeployment({ chainId: MAINNET })),
    ).toBe(`?chainId=${MAINNET}`);
    expect(buildEscrowQuery({ chainId: SEPOLIA })).toBe(
      `?chainId=${SEPOLIA}`,
    );
  });

  it("serializes non-canonical to ?chainId=X&escrow=0x...", () => {
    const historical = getEscrowDeployment({
      chainId: SEPOLIA,
      escrowAddress: SEPOLIA_HISTORICAL_V1,
    });
    expect(buildEscrowQuery(historical)).toBe(
      `?chainId=${SEPOLIA}&escrow=${SEPOLIA_HISTORICAL_V1}`,
    );
    expect(
      buildEscrowQuery({ chainId: SEPOLIA, escrowAddress: SEPOLIA_HISTORICAL_V1 }),
    ).toBe(`?chainId=${SEPOLIA}&escrow=${SEPOLIA_HISTORICAL_V1}`);
  });

  it("isCanonicalDeployment distinguishes canonical from historical", () => {
    expect(
      isCanonicalDeployment(getEscrowDeployment({ chainId: SEPOLIA })),
    ).toBe(true);
    expect(
      isCanonicalDeployment(
        getEscrowDeployment({
          chainId: SEPOLIA,
          escrowAddress: SEPOLIA_HISTORICAL_V1,
        }),
      ),
    ).toBe(false);
  });
});

describe("escrowIdentity — param helpers", () => {
  it("parseEscrowParam distinguishes absent/valid/invalid", () => {
    expect(parseEscrowParam(null)).toEqual({ status: "absent" });
    expect(parseEscrowParam("")).toEqual({ status: "absent" });
    expect(parseEscrowParam("   ")).toEqual({ status: "absent" });
    expect(parseEscrowParam(FAKE_UNKNOWN)).toEqual({
      status: "valid",
      address: FAKE_UNKNOWN,
    });
    expect(parseEscrowParam("0x123").status).toBe("invalid");
  });

  it("pickEscrowParam returns the first non-empty candidate", () => {
    expect(pickEscrowParam(null, undefined, "", "  ", FAKE_UNKNOWN)).toBe(
      FAKE_UNKNOWN,
    );
    expect(pickEscrowParam(null, "")).toBeUndefined();
  });

  it("lowercase and checksummed inputs resolve identically", () => {
    const checksummed = getEscrowDeployment({
      chainId: SEPOLIA,
      escrowAddress: SEPOLIA_CANONICAL_V1,
    });
    const lowercased = getEscrowDeployment({
      chainId: SEPOLIA,
      escrowAddress: SEPOLIA_CANONICAL_V1.toLowerCase(),
    });
    expect(lowercased).toEqual(checksummed);
    expect(lowercased.address).toBe(SEPOLIA_CANONICAL_V1);
  });
});

describe("escrowIdentity — deployment config discrimination (V1 vs V2)", () => {
  it("returns the V1 ABI for V1 deployments", () => {
    const config = getEscrowDeploymentConfig(
      getEscrowDeployment({ chainId: MAINNET }),
    );
    expect(config.kind).toBe("v1");
    expect(config.address).toBe(MAINNET_CANONICAL_V1);
    expect(config.abi).toBe(protectedPaymentEscrowABI);
  });

  it("returns the V2 ABI for V2 deployments (fixture)", () => {
    const fixture = deploymentsWithFutureV2();
    const config = getEscrowDeploymentConfig(
      getEscrowDeployment(
        { chainId: SEPOLIA, escrowAddress: FAKE_SEPOLIA_V2 },
        fixture,
      ),
    );
    expect(config.kind).toBe("v2");
    expect(config.address).toBe(FAKE_SEPOLIA_V2);
    expect(config.abi).toBe(protectedPaymentEscrowV2ABI);
  });
});

describe("escrowIdentity — ABI surface (V2 autopilot vs V1 absence)", () => {
  function entryNames(abi: unknown): (string | undefined)[] {
    return (abi as { name?: string }[]).map((e) => e.name);
  }

  it("V2 ABI contains executeAutoRelease/getAutoReleaseEligibility/AutoReleased + autopilotEnabled fields", () => {
    const names = entryNames(protectedPaymentEscrowV2ABI);
    expect(names).toContain("executeAutoRelease");
    expect(names).toContain("getAutoReleaseEligibility");
    expect(names).toContain("AutoReleased");
    // autopilotEnabled is a createPayment input + Payment struct field
    // (not a top-level entry) — asserted structurally below.
    const v2 = protectedPaymentEscrowV2ABI as unknown as {
      name?: string;
      type?: string;
      inputs?: { name?: string }[];
      outputs?: { components?: { name?: string }[] }[];
    }[];
    const create = v2.find(
      (e) => e.name === "createPayment" && e.type === "function",
    );
    expect(create!.inputs!.map((i) => i.name)).toContain("autopilotEnabled");
    const getPayment = v2.find(
      (e) => e.name === "getPayment" && e.type === "function",
    );
    const components = getPayment!.outputs![0]!.components!.map((c) => c.name);
    expect(components).toContain("autopilotEnabled");
  });

  it("V2 createPayment has 11 params ending in autopilotEnabled", () => {
    const create = (
      protectedPaymentEscrowV2ABI as unknown as {
        name?: string;
        type?: string;
        inputs?: { name?: string }[];
      }[]
    ).find((e) => e.name === "createPayment" && e.type === "function");
    expect(create).toBeDefined();
    expect(create!.inputs).toHaveLength(11);
    expect(create!.inputs![10]!.name).toBe("autopilotEnabled");
  });

  it("V1 ABI lacks all V2-only functions/events/params", () => {
    const names = entryNames(protectedPaymentEscrowABI);
    expect(names).not.toContain("executeAutoRelease");
    expect(names).not.toContain("getAutoReleaseEligibility");
    expect(names).not.toContain("AutoReleased");
    expect(names).not.toContain("autopilotEnabled");
    const create = (
      protectedPaymentEscrowABI as unknown as {
        name?: string;
        type?: string;
        inputs?: { name?: string }[];
      }[]
    ).find((e) => e.name === "createPayment" && e.type === "function");
    expect(create).toBeDefined();
    expect(create!.inputs).toHaveLength(10);
  });
});
