// ---------------------------------------------------------------------------
// paymentLifecycle — exact labels + fail-closed chain parsing (no tx).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  getPaymentLifecycleLabel,
  parseChainIdParam,
} from "../paymentLifecycle";

describe("getPaymentLifecycleLabel — exact mapping", () => {
  it("maps Funded to Protected", () => {
    expect(getPaymentLifecycleLabel("Funded")).toBe("Protected");
  });

  it("maps Accepted to Accepted", () => {
    expect(getPaymentLifecycleLabel("Accepted")).toBe("Accepted");
  });

  it("maps DeliverySubmitted to Delivered", () => {
    expect(getPaymentLifecycleLabel("DeliverySubmitted")).toBe("Delivered");
  });

  it("maps ReleaseRequested to Release requested (exact case)", () => {
    expect(getPaymentLifecycleLabel("ReleaseRequested")).toBe(
      "Release requested",
    );
  });

  it("maps Released to Released", () => {
    expect(getPaymentLifecycleLabel("Released")).toBe("Released");
  });

  it("Created must NOT read protected", () => {
    const label = getPaymentLifecycleLabel("Created");
    expect(label).toBe("Created");
    expect(label.toLowerCase()).not.toContain("protect");
  });

  it("keeps dispute states accurate", () => {
    expect(getPaymentLifecycleLabel("Disputed")).toBe("Disputed");
    expect(getPaymentLifecycleLabel("Cancelled")).toBe("Cancelled");
  });

  it("does not mark future states completed", () => {
    expect(getPaymentLifecycleLabel("Resolved")).toBe("Resolved");
  });
});

describe("parseChainIdParam — fail closed, no silent fallback", () => {
  it("absent preserves default behavior", () => {
    expect(parseChainIdParam(null)).toEqual({ status: "default" });
    expect(parseChainIdParam(undefined)).toEqual({ status: "default" });
    expect(parseChainIdParam("")).toEqual({ status: "default" });
  });

  it("resolves explicit mainnet 42220", () => {
    expect(parseChainIdParam("42220")).toEqual({
      status: "explicit",
      chainId: 42220,
    });
  });

  it("resolves explicit Sepolia (regression)", () => {
    expect(parseChainIdParam("11142220")).toEqual({
      status: "explicit",
      chainId: 11142220,
    });
  });

  it("fails closed on malformed input", () => {
    for (const raw of ["abc", "0xA4B1", "42220abc", "42 220", "-1", "1.5", "0"]) {
      const res = parseChainIdParam(raw);
      expect(res.status).toBe("invalid");
    }
  });

  it("fails closed on unsupported numeric chain", () => {
    expect(parseChainIdParam("1").status).toBe("invalid");
    expect(parseChainIdParam("137").status).toBe("invalid");
    expect(parseChainIdParam("99999999").status).toBe("invalid");
  });

  it("trims whitespace for canonical form", () => {
    expect(parseChainIdParam(" 42220 ")).toEqual({
      status: "explicit",
      chainId: 42220,
    });
  });
});
