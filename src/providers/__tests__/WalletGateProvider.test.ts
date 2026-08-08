// ---------------------------------------------------------------------------
// WalletGateProvider — stale gate auto-dismiss logic test
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";

/**
 * Determines whether the switch-network gate should auto-dismiss.
 *
 * The gate should close when:
 *   - The gate is currently showing the switch dialog (mode === "switch")
 *   - The wallet has become connected on a supported chain
 *
 * Returns true when the gate should auto-close. When true, the pending
 * action must be cleared (user must explicitly retry).
 */
function shouldAutoDismissSwitchGate(
  mode: "connect" | "switch" | null,
  isConnected: boolean,
  chainSupported: boolean,
): boolean {
  if (mode !== "switch") return false;
  return isConnected && chainSupported;
}

describe("shouldAutoDismissSwitchGate", () => {
  it("returns false when not in switch mode", () => {
    expect(shouldAutoDismissSwitchGate(null, true, true)).toBe(false);
    expect(shouldAutoDismissSwitchGate("connect", true, true)).toBe(false);
  });

  it("returns false when wallet is not connected", () => {
    expect(shouldAutoDismissSwitchGate("switch", false, false)).toBe(false);
    expect(shouldAutoDismissSwitchGate("switch", false, true)).toBe(false);
  });

  it("returns false when chain is unsupported", () => {
    // Stale gate — chainSupported still false
    expect(shouldAutoDismissSwitchGate("switch", true, false)).toBe(false);
  });

  it("returns true when chain becomes supported after stale gate", () => {
    // Gate is open, wallet connected, chain now supported
    expect(shouldAutoDismissSwitchGate("switch", true, true)).toBe(true);
  });

  it("returns true re-actively when chain resolves", () => {
    // Simulate: stale state (chain undefined → false)
    const stale = shouldAutoDismissSwitchGate("switch", true, false);
    expect(stale).toBe(false);

    // After hydration: chain resolves to valid (chainSupported → true)
    const resolved = shouldAutoDismissSwitchGate("switch", true, true);
    expect(resolved).toBe(true);
  });
});
