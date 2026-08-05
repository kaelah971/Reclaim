import { describe, it, expect } from "vitest";
import {
  createBudget,
  getRemainingBudget,
  canReserveAmount,
  reserveAmount,
  applySpend,
  releaseReservation,
} from "../budget";
import { InvalidBudgetOperationError } from "../errors";

describe("Budget Creation", () => {
  it("creates budget with approved amount", () => {
    const budget = createBudget(1000000n);
    expect(budget.approvedAtomic).toBe(1000000n);
    expect(budget.spentAtomic).toBe(0n);
    expect(budget.reservedAtomic).toBe(0n);
  });

  it("rejects negative approved budget", () => {
    expect(() => createBudget(-1n)).toThrow(InvalidBudgetOperationError);
  });

  it("accepts zero approved budget", () => {
    const budget = createBudget(0n);
    expect(budget.approvedAtomic).toBe(0n);
  });
});

describe("getRemainingBudget", () => {
  it("returns full approved when nothing spent or reserved", () => {
    const budget = createBudget(1000000n);
    expect(getRemainingBudget(budget)).toBe(1000000n);
  });

  it("subtracts spent from remaining", () => {
    const budget = createBudget(1000000n);
    const withSpend = applySpend(reserveAmount(budget, 10000n), 10000n);
    expect(getRemainingBudget(withSpend)).toBe(990000n);
  });

  it("subtracts reserved from remaining", () => {
    const budget = createBudget(1000000n);
    const reserved = reserveAmount(budget, 50000n);
    expect(getRemainingBudget(reserved)).toBe(950000n);
  });

  it("subtracts both spent and reserved", () => {
    const budget = createBudget(1000000n);
    const r1 = reserveAmount(budget, 10000n);
    const s1 = applySpend(r1, 10000n);
    const r2 = reserveAmount(s1, 20000n);
    // remaining = 1000000 - 10000 - 20000 = 970000
    expect(getRemainingBudget(r2)).toBe(970000n);
  });

  it("returns zero when budget exhausted", () => {
    const budget = createBudget(10000n);
    const spend = applySpend(reserveAmount(budget, 10000n), 10000n);
    expect(getRemainingBudget(spend)).toBe(0n);
  });

  it("clamps to zero if spent exceeds approved (edge case)", () => {
    const budget = {
      approvedAtomic: 10000n,
      spentAtomic: 10000n,
      reservedAtomic: 10000n,
    };
    // remaining would be -10000, but getRemainingBudget clamps to 0
    expect(getRemainingBudget(budget)).toBe(0n);
  });
});

describe("canReserveAmount", () => {
  it("allows reservation within remaining budget", () => {
    const budget = createBudget(1000000n);
    expect(canReserveAmount(budget, 10000n)).toBe(true);
  });

  it("rejects reservation exceeding remaining budget", () => {
    const budget = createBudget(10000n);
    expect(canReserveAmount(budget, 20000n)).toBe(false);
  });

  it("rejects zero amount reservation", () => {
    const budget = createBudget(1000000n);
    expect(canReserveAmount(budget, 0n)).toBe(false);
  });

  it("rejects negative amount reservation", () => {
    const budget = createBudget(1000000n);
    expect(canReserveAmount(budget, -1n)).toBe(false);
  });
});

describe("reserveAmount", () => {
  it("increases reserved atomic", () => {
    const budget = createBudget(1000000n);
    const result = reserveAmount(budget, 10000n);
    expect(result.reservedAtomic).toBe(10000n);
    expect(result.spentAtomic).toBe(0n);
    expect(result.approvedAtomic).toBe(1000000n);
  });

  it("throws when exceeding budget", () => {
    const budget = createBudget(5000n);
    expect(() => reserveAmount(budget, 10000n)).toThrow(
      InvalidBudgetOperationError,
    );
  });

  it("throws on zero amount", () => {
    const budget = createBudget(1000000n);
    expect(() => reserveAmount(budget, 0n)).toThrow(
      InvalidBudgetOperationError,
    );
  });

  it("throws on negative amount", () => {
    const budget = createBudget(1000000n);
    expect(() => reserveAmount(budget, -1n)).toThrow(
      InvalidBudgetOperationError,
    );
  });

  it("repeated reservation cannot overspend", () => {
    const budget = createBudget(10000n);
    const first = reserveAmount(budget, 5000n);
    expect(getRemainingBudget(first)).toBe(5000n);
    const second = reserveAmount(first, 5000n);
    expect(getRemainingBudget(second)).toBe(0n);
    expect(() => reserveAmount(second, 100n)).toThrow(
      InvalidBudgetOperationError,
    );
  });
});

describe("applySpend", () => {
  it("moves reserved to spent", () => {
    const budget = createBudget(1000000n);
    const reserved = reserveAmount(budget, 10000n);
    const spent = applySpend(reserved, 10000n);
    expect(spent.spentAtomic).toBe(10000n);
    expect(spent.reservedAtomic).toBe(0n);
    expect(spent.approvedAtomic).toBe(1000000n);
  });

  it("partial spend reduces reserved", () => {
    const budget = createBudget(1000000n);
    const reserved = reserveAmount(budget, 50000n);
    const spent = applySpend(reserved, 30000n);
    expect(spent.spentAtomic).toBe(30000n);
    expect(spent.reservedAtomic).toBe(20000n);
  });

  it("throws when spending more than reserved", () => {
    const budget = createBudget(1000000n);
    const reserved = reserveAmount(budget, 5000n);
    expect(() => applySpend(reserved, 10000n)).toThrow(
      InvalidBudgetOperationError,
    );
  });

  it("throws on zero amount", () => {
    const budget = createBudget(1000000n);
    expect(() => applySpend(budget, 0n)).toThrow(InvalidBudgetOperationError);
  });

  it("throws on negative amount", () => {
    const budget = createBudget(1000000n);
    expect(() => applySpend(budget, -1n)).toThrow(InvalidBudgetOperationError);
  });
});

describe("releaseReservation", () => {
  it("releases reserved amount back", () => {
    const budget = createBudget(1000000n);
    const reserved = reserveAmount(budget, 10000n);
    expect(reserved.reservedAtomic).toBe(10000n);
    const released = releaseReservation(reserved, 10000n);
    expect(released.reservedAtomic).toBe(0n);
    expect(getRemainingBudget(released)).toBe(1000000n);
  });

  it("partial release works", () => {
    const budget = createBudget(1000000n);
    const reserved = reserveAmount(budget, 50000n);
    const released = releaseReservation(reserved, 20000n);
    expect(released.reservedAtomic).toBe(30000n);
  });

  it("throws when releasing more than reserved", () => {
    const budget = createBudget(1000000n);
    const reserved = reserveAmount(budget, 5000n);
    expect(() => releaseReservation(reserved, 10000n)).toThrow(
      InvalidBudgetOperationError,
    );
  });

  it("failed reservation restores availability", () => {
    const budget = createBudget(1000000n);
    const reserved = reserveAmount(budget, 10000n);
    expect(getRemainingBudget(reserved)).toBe(990000n);
    const released = releaseReservation(reserved, 10000n);
    expect(getRemainingBudget(released)).toBe(1000000n);
  });
});

describe("Budget — no floating point", () => {
  it("all budget values are bigint, not number", () => {
    const budget = createBudget(1000000n);
    expect(typeof budget.approvedAtomic).toBe("bigint");
    expect(typeof budget.spentAtomic).toBe("bigint");
    expect(typeof budget.reservedAtomic).toBe("bigint");
  });

  it("getRemainingBudget returns bigint", () => {
    const budget = createBudget(1000000n);
    expect(typeof getRemainingBudget(budget)).toBe("bigint");
  });
});

describe("Budget — escrow separation", () => {
  it("budget does not include escrow amount", () => {
    const budget = createBudget(10000n);
    expect(budget.approvedAtomic).toBe(10000n);
    expect(budget.spentAtomic).toBe(0n);
    // The escrow amount (the protected payment) is tracked separately
    // in the ProtectedPaymentEscrow contract. The agent budget is purely
    // for x402 service fees.
  });
});
