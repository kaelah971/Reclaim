// ---------------------------------------------------------------------------
// /payments/new validation — pure unit tests (P4.2b).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  isValidWorkerAddress,
  parseAmountToRaw,
  validatePaymentStep,
  validateTermsStep,
} from "../validation";

const WORKER = "0x2222222222222222222222222222222222222222";
const ZERO = "0x0000000000000000000000000000000000000000";

describe("validatePaymentStep", () => {
  it("requires worker + amount", () => {
    const errs = validatePaymentStep(
      { workerWallet: "", amount: "" },
      6,
      "USA₮",
    );
    expect(errs.workerWallet).toBeTruthy();
    expect(errs.amount).toBeTruthy();
  });

  it("rejects malformed and zero addresses", () => {
    for (const bad of ["0x123", "not-an-address", ZERO, ` ${ZERO} `]) {
      const errs = validatePaymentStep(
        { workerWallet: bad, amount: "10" },
        6,
        "USA₮",
      );
      expect(errs.workerWallet, bad).toBeTruthy();
    }
  });

  it("accepts a valid address with surrounding whitespace", () => {
    const errs = validatePaymentStep(
      { workerWallet: `  ${WORKER} `, amount: "10" },
      6,
      "USA₮",
    );
    expect(errs).toEqual({});
  });

  it("rejects zero / negative / non-numeric amounts", () => {
    for (const bad of ["0", "0.00", "-5", "abc", "1,000"]) {
      const errs = validatePaymentStep(
        { workerWallet: WORKER, amount: bad },
        6,
        "USA₮",
      );
      expect(errs.amount, bad).toBeTruthy();
    }
  });

  it("enforces the actual token decimals in copy", () => {
    const errs = validatePaymentStep(
      { workerWallet: WORKER, amount: "1.1234567" },
      6,
      "USA₮",
    );
    expect(errs.amount).toBe("USA₮ supports at most 6 decimal places.");
  });
});

describe("parseAmountToRaw", () => {
  it("parses against the given decimals", () => {
    expect(parseAmountToRaw("1.50", 6)).toBe(1_500_000n);
    expect(parseAmountToRaw("100", 6)).toBe(100_000_000n);
    expect(parseAmountToRaw("0.000001", 6)).toBe(1n);
  });

  it("returns null for too many decimals or non-positive input", () => {
    expect(parseAmountToRaw("1.0000001", 6)).toBeNull();
    expect(parseAmountToRaw("0", 6)).toBeNull();
    expect(parseAmountToRaw("", 6)).toBeNull();
    expect(parseAmountToRaw("abc", 6)).toBeNull();
  });
});

describe("validateTermsStep", () => {
  const valid = {
    title: "Landing page",
    deliverable: "Design files",
    deliveryFormat: "Figma",
    deadline: "2030-01-01",
    releaseRule: "buyer-approval",
  };

  it("accepts a complete step", () => {
    expect(validateTermsStep(valid)).toEqual({});
  });

  it("requires title, deliverable, deadline and release choice", () => {
    const errs = validateTermsStep({
      ...valid,
      title: "",
      deliverable: "",
      deadline: "",
      releaseRule: "",
    });
    expect(errs.title).toBeTruthy();
    expect(errs.deliverable).toBeTruthy();
    expect(errs.deadline).toBeTruthy();
    expect(errs.releaseRule).toBeTruthy();
  });

  it("rejects past deadlines", () => {
    const errs = validateTermsStep({ ...valid, deadline: "2020-01-01" });
    expect(errs.deadline).toMatch(/future/);
  });

  it("enforces the 32-byte agreement-record limit in plain words", () => {
    const errs = validateTermsStep({
      ...valid,
      title: "a".repeat(33),
      deliveryFormat: "é".repeat(17), // 34 UTF-8 bytes
    });
    expect(errs.title).toMatch(/32 characters/);
    expect(errs.title).not.toMatch(/on-chain/i);
    expect(errs.deliveryFormat).toMatch(/32 characters/);
  });

  it("uses plain-language copy without jargon", () => {
    const errs = validateTermsStep({
      ...valid,
      title: "",
      releaseRule: "",
    });
    expect(errs.title).not.toMatch(/stored on-chain/i);
    expect(errs.releaseRule).not.toMatch(/release rule/i);
  });

  it("isValidWorkerAddress gates formats", () => {
    expect(isValidWorkerAddress(WORKER)).toBe(true);
    expect(isValidWorkerAddress(ZERO)).toBe(false);
    expect(isValidWorkerAddress("0x123")).toBe(false);
  });
});
