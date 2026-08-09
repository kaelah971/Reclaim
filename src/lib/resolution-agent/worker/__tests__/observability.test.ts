// ---------------------------------------------------------------------------
// Worker failure observability (RA1R.7I)
//
// Dispatch/execution failures must always be surfaced: the iteration result
// carries the sanitized error AND a sanitized worker_iteration_failed event
// is persisted (best-effort). No secrets may ever be stored or returned.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import {
  sanitizeWorkerError,
  recordWorkerIterationFailure,
} from "../service";

describe("sanitizeWorkerError", () => {
  it("redacts private keys and wallet-auth secrets", () => {
    const raw =
      "sk-1234567890abcdef privateKey=0xdeadbeef ciphertext=abc authenticationTag=def";
    const safe = sanitizeWorkerError(raw);
    expect(safe).not.toContain("sk-1234567890abcdef");
    expect(safe).not.toContain("privateKey");
    expect(safe).not.toContain("ciphertext");
    expect(safe).not.toContain("authenticationTag");
  });

  it("redacts long hex payloads (signatures/request hashes must not leak)", () => {
    const safe = sanitizeWorkerError(
      "failure at 0x1f6c8f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f",
    );
    expect(safe).toContain("[REDACTED_HEX]");
    expect(safe).not.toMatch(/0x[0-9a-fA-F]{64,}/);
  });

  it("keeps the human-readable reason intact", () => {
    const safe = sanitizeWorkerError("Atomic reservation failed: version conflict");
    expect(safe).toContain("Atomic reservation failed: version conflict");
  });
});

describe("recordWorkerIterationFailure", () => {
  it("persists a sanitized failure event with the agent id", async () => {
    const appendEvent = vi.fn().mockResolvedValue(undefined);
    const store = { appendEvent } as unknown as Parameters<
      typeof recordWorkerIterationFailure
    >[0];

    await recordWorkerIterationFailure(
      store,
      "agt_f1f9a3f6-b2ab-4719-995f-90a6d7867235",
      new Error("Atomic reservation failed: privateKey=0xabc ciphertext"),
    );

    expect(appendEvent).toHaveBeenCalledTimes(1);
    const [agentId, eventType, reason] = appendEvent.mock.calls[0];
    expect(agentId).toBe("agt_f1f9a3f6-b2ab-4719-995f-90a6d7867235");
    expect(eventType).toBe("worker_iteration_failed");
    expect(String(reason)).toContain("Atomic reservation failed");
    expect(String(reason)).not.toContain("privateKey");
    expect(String(reason)).not.toContain("ciphertext");
  });

  it("never stores signatures or long hex payloads", async () => {
    const appendEvent = vi.fn().mockResolvedValue(undefined);
    const store = { appendEvent } as unknown as Parameters<
      typeof recordWorkerIterationFailure
    >[0];
    const signature =
      "0x1f6c8f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f";

    await recordWorkerIterationFailure(store, "agt_x", new Error(`signed: ${signature}`));

    const persisted = JSON.stringify(appendEvent.mock.calls[0]);
    expect(persisted).not.toContain(signature.slice(0, 16));
    expect(persisted).toContain("[REDACTED_HEX]");
  });

  it("is best-effort — a store failure never throws", async () => {
    const appendEvent = vi.fn().mockRejectedValue(new Error("db down"));
    const store = { appendEvent } as unknown as Parameters<
      typeof recordWorkerIterationFailure
    >[0];

    await expect(
      recordWorkerIterationFailure(store, "agt_x", new Error("boom")),
    ).resolves.toBeUndefined();
  });

  it("no-ops without an agent id", async () => {
    const appendEvent = vi.fn();
    const store = { appendEvent } as unknown as Parameters<
      typeof recordWorkerIterationFailure
    >[0];

    await recordWorkerIterationFailure(store, null, new Error("boom"));
    expect(appendEvent).not.toHaveBeenCalled();
  });
});
