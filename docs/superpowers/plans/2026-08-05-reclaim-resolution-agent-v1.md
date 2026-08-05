# Reclaim Resolution Agent V1 Implementation Plan

> For agentic workers: execute this plan task-by-task with tests and review gates.

**Status:** Plan approved — Task 1 implemented, Tasks 2-20 pending
**Date:** 2026-08-05
**Design Reference:** `docs/superpowers/specs/2026-08-05-reclaim-resolution-agent-design.md`

---

## Goal

Build a persistent autonomous Resolution Agent that prepares protected-payment cases for fair human review, purchases allowlisted x402 tools from a bounded per-case wallet, waits for meaningful case updates, resumes automatically, and stops before final judgment or escrow settlement.

## Architecture

Use a Supabase-backed state machine, one encrypted server-controlled wallet per case, a scheduled secure worker, strict budget/tool policies, durable x402 recovery, and a Proof Ledger control-room interface.

## Tech Stack

Use the repository's existing Next.js, TypeScript, Supabase, wagmi/viem, x402, validation, test, and build infrastructure.

## Canonical Values (from repository)

| Value | Repository Constant | Source |
|---|---|---|
| Evidence Quality Check identifier | `evidence-quality-check` | `src/lib/x402/requestHash.ts:5` |
| Dispute Brief identifier | `reclaim-dispute-brief-v1` | `src/lib/x402/requestHash.ts:4` |
| Case Refresh identifier | `case-refresh` | New — not yet in repository |
| Evidence Quality Check price | $0.01 USDC (`10000n` atomic) | `getEvidenceCheckPriceAtomic()` in `config.ts:173` |
| Dispute Brief price | $0.01 USDC (`10000n` atomic) | `getDisputeBriefPriceAtomic()` in `config.ts:144` |
| Case Refresh price | $0.01 USDC (`10000n` atomic) | New — follows same pattern |
| Facilitator network | `eip155:42220` (Celo Mainnet) | `X402_FACILITATOR_NETWORK` in `config.ts:56` |
| Mainnet USDC address | `0xcebA9300f2b948710d2653dD7B07f33A8B32118C` | `X402_FACILITATOR_USDC_MAINNET` in `config.ts:52` |
| Registered payTo | `0x85522bdE267d05bf8CE8813F97c75417b7894A33` | `X402_PAY_TO_ADDRESS_FACILITATOR` in `config.ts:67` |
| USDC decimals | 6 | `PAYMENT_TOKEN_DECIMALS` in `tokens.ts:14` |

## Constraints

- Contracts are not modified
- Escrow funds are never controlled by the agent
- Private keys never reach the browser
- The agent cannot decide the winner
- No live payment happens during implementation phases without explicit approval
- Settled x402 requests are recovered without paying again
- One safe action is processed per worker iteration
- Mutual security bonds remain future-only

---

## Task 1: Agent Domain Types, Lifecycle and Policy

**Files created:**
- `src/lib/resolution-agent/types.ts`
- `src/lib/resolution-agent/tools.ts`
- `src/lib/resolution-agent/state-machine.ts`
- `src/lib/resolution-agent/policy.ts`
- `src/lib/resolution-agent/budget.ts`
- `src/lib/resolution-agent/public-view.ts`
- `src/lib/resolution-agent/errors.ts`
- `src/lib/resolution-agent/index.ts`
- `src/lib/resolution-agent/__tests__/types.test.ts`
- `src/lib/resolution-agent/__tests__/state-machine.test.ts`
- `src/lib/resolution-agent/__tests__/policy.test.ts`
- `src/lib/resolution-agent/__tests__/budget.test.ts`
- `src/lib/resolution-agent/__tests__/tools.test.ts`
- `src/lib/resolution-agent/__tests__/public-view.test.ts`

**Interfaces consumed:** None (pure domain layer)

**Interfaces produced:**
- `ResolutionAgent`, `ResolutionAgentStatus`, `ResolutionAgentPolicy`
- `ResolutionAgentPlan`, `ResolutionAgentPlanStep`, `ResolutionAgentObservation`
- `ResolutionAgentToolDefinition`, `ResolutionAgentToolId`, `ResolutionAgentToolRequest`
- `ResolutionAgentToolExecutionDecision`
- `AgentCaseIdentity`, `AgentBudget`, `AgentExpiry`
- `EncryptedWalletSecret`
- `ResolutionAgentPublicView`

**Failing test step:** Write tests for lifecycle transitions, tool allowlist, budget arithmetic, policy decisions, and public-view serialization.

**Verification command:** `npx vitest run src/lib/resolution-agent/__tests__/`

**Minimal implementation step:** Implement types, state machine, tool definitions, budget helpers, policy engine, public-view mapper, and domain errors.

**Passing test command:** `npx vitest run src/lib/resolution-agent/__tests__/`

**Commit message:** `feat: add resolution agent domain foundation`

**Review gate:** Confirm all tests pass, TypeScript compiles, lint is clean. No API routes, no DB migration, no wallet generation, no contract changes.

---

## Task 2: Server-Side Wallet Generation and Authenticated Encryption

**Files created/modified:**
- `src/lib/resolution-agent/wallet.ts`
- `src/lib/resolution-agent/encryption.ts`
- `src/lib/resolution-agent/__tests__/wallet.test.ts`
- `src/lib/resolution-agent/__tests__/encryption.test.ts`

**Interfaces consumed:** `EncryptedWalletSecret` from Task 1 types

**Interfaces produced:**
- `generateCaseWallet(): { address: string; secret: EncryptedWalletSecret }`
- `decryptCaseWallet(secret: EncryptedWalletSecret): PrivateKeyMaterial`
- `CaseWallet` (address + encrypted secret pairs)

**Failing test step:** Tests verify wallet generation produces valid EVM addresses, encryption round-trips, decryption fails with wrong key, ciphertext format is validated, and plaintext is never in logs.

**Verification command:** `npx vitest run src/lib/resolution-agent/__tests__/wallet.test.ts src/lib/resolution-agent/__tests__/encryption.test.ts`

**Minimal implementation step:** Use Node.js crypto (aes-256-gcm) with server-only env key. Document KMS/HSM migration path.

**Review gate:** Encryption uses env-held key only. Ciphertext only in memory/DB, plaintext only inside secure worker scope.

---

## Task 3: Supabase Migration and Durable Agent Store

**Files created/modified:**
- `supabase/migrations/XXXXXX_resolution_agent.sql` (generated by drizzle)
- `src/lib/resolution-agent/schema.ts` (Drizzle schema)
- `src/lib/resolution-agent/store.ts` (CRUD operations)
- `src/lib/resolution-agent/__tests__/store.test.ts`

**Interfaces consumed:** All domain types from Task 1, wallet types from Task 2

**Interfaces produced:**
- `createAgent(identity, policy): Promise<ResolutionAgent>`
- `getAgent(agentId): Promise<ResolutionAgent | null>`
- `updateAgent(agentId, updates): Promise<ResolutionAgent>`
- `recordToolExecution(agentId, execution): Promise<void>`
- `getToolExecutions(agentId): Promise<ToolExecution[]>`
- `getActiveAgents(): Promise<ResolutionAgent[]>`

**Failing test step:** CRUD tests using Supabase client (or in-memory mock if Supabase not configured).

**Run drizzle generate + migrate.** Do NOT use drizzle push.

**Review gate:** Encrypted secrets stored as text (base64 ciphertext). No plaintext in DB.

---

## Task 4: Agent Creation, Funding-Status and Activation APIs

**Files created/modified:**
- `src/app/api/agent/create/route.ts`
- `src/app/api/agent/status/route.ts`
- `src/app/api/agent/activate/route.ts`
- `src/lib/resolution-agent/__tests__/api.test.ts`

**Interfaces consumed:** Store from Task 3, wallet from Task 2, types from Task 1

**Interfaces produced:** REST endpoints for agent lifecycle

**Failing test step:** HTTP tests against API routes.

**Review gate:** Create generates wallet server-side only. Activate requires explicit user confirmation.

---

## Task 5: Case Observation and Deterministic Case-Version Hashing

**Files created/modified:**
- `src/lib/resolution-agent/observer.ts`
- `src/lib/resolution-agent/__tests__/observer.test.ts`

**Interfaces consumed:** Escrow contract read hooks, evidence inventory

**Interfaces produced:**
- `observeCase(agentIdentity): Promise<ResolutionAgentObservation>`
- `computeCaseVersion(paymentState, evidence): string` (deterministic hash)
- `computeEvidenceVersion(evidence): string` (deterministic hash)

**Review gate:** Same inputs produce same hash. Different evidence produces different hash.

---

## Task 6: Planner and One-Action Decision Engine

**Files created/modified:**
- `src/lib/resolution-agent/planner.ts`
- `src/lib/resolution-agent/__tests__/planner.test.ts`

**Interfaces consumed:** Types from Task 1, observer from Task 5

**Interfaces produced:**
- `createPlan(agent, observation): ResolutionAgentPlan`
- `selectNextAction(agent, plan): ResolutionAgentToolRequest | null`

**Review gate:** Planner never selects more than one action. Planner enters waiting states appropriately.

---

## Task 7: Secure Worker Locking, Leases and Recovery

**Files created/modified:**
- `src/lib/resolution-agent/worker.ts`
- `src/lib/resolution-agent/__tests__/worker.test.ts`

**Interfaces consumed:** Store from Task 3, planner from Task 6, policy from Task 1

**Interfaces produced:**
- `acquireWorkerLock(agentId): Promise<boolean>`
- `releaseWorkerLock(agentId): Promise<void>`
- `processOneAgentAction(agentId): Promise<void>`
- `recoverSettledRequests(agentId): Promise<void>`

**Review gate:** Concurrent workers cannot execute duplicate settlements. Lease has expiry.

---

## Task 8: Evidence Quality Check Agent-Tool Adapter

**Files created/modified:**
- `src/lib/resolution-agent/adapters/evidence-quality-check.ts`
- `src/lib/resolution-agent/__tests__/adapters/evidence-quality-check.test.ts`

**Interfaces consumed:** x402 facilitator config, evidence check API route

**Interfaces produced:**
- `buildEvidenceCheckRequest(agent, observation): ResolutionAgentToolRequest`
- `executeEvidenceCheck(agent, request): Promise<ToolExecutionResult>`

**Review gate:** Adapter uses canonical identifier `evidence-quality-check` and canonical price.

---

## Task 9: Case Refresh x402 Service and Agent-Tool Adapter

**Files created/modified:**
- `src/app/api/x402/case-refresh/route.ts` (new x402 paid service)
- `src/lib/x402/caseRefreshValidation.ts` (Zod schema)
- `src/lib/x402/caseRefresh.ts` (deterministic logic)
- `src/lib/resolution-agent/adapters/case-refresh.ts`
- `src/lib/resolution-agent/__tests__/adapters/case-refresh.test.ts`
- `src/lib/x402/__tests__/caseRefresh.test.ts`

**Interfaces consumed:** x402 shared types, observer from Task 5

**Interfaces produced:** Full x402 v2 API endpoint for case refresh, agent adapter

**Review gate:** Case Refresh is deterministic (no AI). Canonical identifier `case-refresh`, price $0.01 USDC.

---

## Task 10: Dispute Brief Agent-Tool Adapter

**Files created/modified:**
- `src/lib/resolution-agent/adapters/dispute-brief.ts`
- `src/lib/resolution-agent/__tests__/adapters/dispute-brief.test.ts`

**Interfaces consumed:** Existing dispute brief x402 endpoint, types

**Interfaces produced:**
- `buildDisputeBriefRequest(agent, observation): ResolutionAgentToolRequest`
- `executeDisputeBrief(agent, request): Promise<ToolExecutionResult>`

**Review gate:** Adapter uses canonical identifier `reclaim-dispute-brief-v1` and canonical price.

---

## Task 11: Automatic Evidence-Request Creation and Waiting Behavior

**Files created/modified:**
- `src/lib/resolution-agent/evidence-request.ts`
- `src/lib/resolution-agent/__tests__/evidence-request.test.ts`

**Interfaces consumed:** Types from Task 1, planner from Task 6

**Interfaces produced:**
- `createEvidenceRequest(agent, gap): EvidenceRequest`
- `evaluateWaitingState(agent): ResolutionAgentStatus` (returns waiting_for_evidence or active)

**Review gate:** Agent enters waiting_for_evidence until meaningful case-version change.

---

## Task 12: Automatic Resumption After Meaningful Case Changes

**Files created/modified:**
- `src/lib/resolution-agent/resumer.ts`
- `src/lib/resolution-agent/__tests__/resumer.test.ts`

**Interfaces consumed:** Observer from Task 5, worker from Task 7

**Interfaces produced:**
- `detectMeaningfulChange(agent, beforeHash, afterHash): boolean`
- `shouldResume(agent): Promise<boolean>`

**Review gate:** Agent detects evidence-version or case-version change and resumes.

---

## Task 13: Resolution Agent Control Room UI

**Files created/modified:**
- `src/components/agent/ResolutionAgentPanel.tsx`
- `src/components/agent/AgentBudgetBar.tsx`
- `src/components/agent/AgentActivityLog.tsx`
- `src/components/agent/AgentToolPurchases.tsx`
- `src/components/agent/EvidenceRequestsDisplay.tsx`
- `src/app/payments/[id]/agent/page.tsx` (or integrated into existing payment room)

**Interfaces consumed:** Public view types from Task 1, API routes from Task 4

**Interfaces produced:** React components following Proof Ledger design language

**Review gate:** Not a chatbot. Not a DeFi dashboard. Uses existing design tokens.

---

## Task 14: Pause and Resume

**Files created/modified:**
- `src/app/api/agent/pause/route.ts`
- `src/app/api/agent/resume/route.ts`
- `src/lib/resolution-agent/__tests__/pause-resume.test.ts`

**Interfaces consumed:** Store from Task 3, state machine from Task 1

**Review gate:** Pause prevents new tool execution. Resume requires valid agent state.

---

## Task 15: Close and Reclaim

**Files created/modified:**
- `src/app/api/agent/close/route.ts`
- `src/lib/resolution-agent/reclaim.ts`
- `src/lib/resolution-agent/__tests__/reclaim.test.ts`

**Interfaces consumed:** Store from Task 3, wallet from Task 2, worker from Task 7

**Interfaces produced:**
- `initiateClose(agentId, funderAddress): Promise<void>`
- `reclaimUnusedFunds(agentId): Promise<SettlementReceipt>`

**Review gate:** Only original funder can close. Unused USDC returns to funder. No auto-close while work pending.

---

## Task 16: Security and Duplicate-Payment Tests

**Files created/modified:**
- `src/lib/resolution-agent/__tests__/security.test.ts`

**Review gate:** Tests cover duplicate-payment prevention, settled-request recovery, policy bypass attempts, budget overflow, concurrent-worker safety.

---

## Task 17: Browser-Close/Server-Restart Recovery Tests

**Files created/modified:**
- `src/lib/resolution-agent/__tests__/recovery.test.ts`

**Review gate:** Agent state persists across simulated restarts. Settled x402 requests recover without re-payment.

---

## Task 18: Controlled End-to-End Test Using Mocks

**Files created/modified:**
- `src/lib/resolution-agent/__tests__/e2e-mocked.test.ts`

**Interfaces consumed:** All modules

**Review gate:** Full agent loop runs against mocks. Plan → select → enforce → execute → persist → reassess cycle completes.

---

## Task 19: One Controlled Real Agentic x402 Demo Run

**Files modified:** None new — uses existing paths

**Review gate:** Explicit approval required before running. Uses real case-wallet funding, real facilitator settlement, real x402 endpoints. One complete run only.

---

## Task 20: Documentation and Submission Evidence

**Files created/modified:**
- `docs/superpowers/2026-08-05-resolution-agent-demo.md`
- Hackathon submission materials as needed

**Review gate:** All specs, plans, and demo evidence finalized.

---

## Self-Review Checklist

- [x] No TBD/TODO placeholders
- [x] No contradictory types (each task builds on prior types)
- [x] No undefined interfaces (all consumed interfaces documented)
- [x] All design requirements mapped to tasks
- [x] Each task is independently testable
- [x] Security boundaries explicit (wallet Task 2, worker Task 7, public-view Task 1)
- [x] No escrow control implied
- [x] No AI-decides-winner implied
- [x] No mutual bond implementation
- [x] Agent goal is fixed string, not free-form
- [x] Three tools only (evidence-quality-check, case-refresh, reclaim-dispute-brief-v1)
- [x] Budget uses bigint atomic units internally
- [x] Encrypted secret is opaque, never in public view
- [x] Only original funder can close/reclaim
