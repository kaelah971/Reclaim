import type { AgentBudget } from "./types";
import { InvalidBudgetOperationError } from "./errors";

// ---------------------------------------------------------------------------
// Budget Factory
// ---------------------------------------------------------------------------

export function createBudget(approvedAtomic: bigint): AgentBudget {
  if (approvedAtomic < 0n) {
    throw new InvalidBudgetOperationError(
      "approved budget must be non-negative",
      { approvedAtomic: String(approvedAtomic) },
    );
  }
  return {
    approvedAtomic,
    spentAtomic: 0n,
    reservedAtomic: 0n,
  };
}

// ---------------------------------------------------------------------------
// Budget Arithmetic (all pure, bigint only)
// ---------------------------------------------------------------------------

export function getRemainingBudget(budget: AgentBudget): bigint {
  const remaining = budget.approvedAtomic - budget.spentAtomic - budget.reservedAtomic;
  if (remaining < 0n) return 0n;
  return remaining;
}

export function canReserveAmount(budget: AgentBudget, amount: bigint): boolean {
  if (amount <= 0n) return false;
  return getRemainingBudget(budget) >= amount;
}

export function reserveAmount(budget: AgentBudget, amount: bigint): AgentBudget {
  if (amount <= 0n) {
    throw new InvalidBudgetOperationError("reservation amount must be positive", {
      amount: String(amount),
    });
  }
  if (!canReserveAmount(budget, amount)) {
    throw new InvalidBudgetOperationError("insufficient remaining budget for reservation", {
      remaining: String(getRemainingBudget(budget)),
      requested: String(amount),
    });
  }
  return {
    ...budget,
    reservedAtomic: budget.reservedAtomic + amount,
  };
}

export function applySpend(budget: AgentBudget, amount: bigint): AgentBudget {
  if (amount <= 0n) {
    throw new InvalidBudgetOperationError("spend amount must be positive", {
      amount: String(amount),
    });
  }
  const newReserved = budget.reservedAtomic - amount;
  if (newReserved < 0n) {
    throw new InvalidBudgetOperationError(
      "cannot spend more than reserved amount",
      {
        reserved: String(budget.reservedAtomic),
        attempted: String(amount),
      },
    );
  }
  const newSpent = budget.spentAtomic + amount;
  if (newSpent > budget.approvedAtomic) {
    throw new InvalidBudgetOperationError(
      "spend exceeds approved budget",
      {
        approved: String(budget.approvedAtomic),
        spent: String(newSpent),
      },
    );
  }
  return {
    ...budget,
    spentAtomic: newSpent,
    reservedAtomic: newReserved,
  };
}

export function releaseReservation(
  budget: AgentBudget,
  amount: bigint,
): AgentBudget {
  if (amount <= 0n) {
    throw new InvalidBudgetOperationError("release amount must be positive", {
      amount: String(amount),
    });
  }
  const newReserved = budget.reservedAtomic - amount;
  if (newReserved < 0n) {
    throw new InvalidBudgetOperationError(
      "cannot release more than reserved amount",
      {
        reserved: String(budget.reservedAtomic),
        attempted: String(amount),
      },
    );
  }
  return {
    ...budget,
    reservedAtomic: newReserved,
  };
}
