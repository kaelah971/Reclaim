# Reclaim Resolution Agent — Design Specification

**Version:** V1
**Date:** 2026-08-05
**Status:** Approved — not yet implemented

---

## 1. Product Definition

Reclaim is an autonomous resolution agent for protected stablecoin payments.

It solves the operational mess between a disputed payment and a fair resolution.

A user gives the agent one fixed goal:

**"Prepare this payment case for fair human review."**

The agent then:

- reads the payment agreement;
- reads the escrow state;
- examines the evidence inventory;
- creates and updates a resolution plan;
- identifies missing or weak evidence;
- chooses approved x402 tools;
- autonomously pays for those tools within a case budget;
- creates evidence requests for the appropriate party;
- waits for new evidence;
- resumes after meaningful case changes;
- prepares a neutral reviewer-ready brief;
- stops before final human judgment.

This is one connected autonomous workflow, not a collection of unrelated AI buttons.

---

## 2. Selected Architecture

- one unique server-controlled wallet per payment case;
- direct USDC funding into that wallet;
- a fixed per-case spending budget;
- a strict x402 service allowlist;
- Supabase-backed persistent agent state;
- a scheduled secure server worker;
- one safe agent action per worker iteration;
- a final human-review boundary;
- an explicit Close and reclaim action.

The agent must continue operating after the browser is closed.

---

## 3. Activation Flow

1. User opens the Resolution Agent section for a payment.
2. Reclaim creates a unique case-agent wallet server-side.
3. User chooses and approves a case budget.
4. User reviews:
   - fixed goal;
   - case budget;
   - allowed tools;
   - expiry;
   - funding/refund address;
   - human-decision boundaries.
5. User sends the exact USDC budget directly to the case wallet.
6. Reclaim confirms funding.
7. User clicks **"Start Resolution Agent."**
8. The agent begins autonomous execution.

Funding confirmation does not automatically start the agent.

The user must perform the final Start Resolution Agent approval once.

After activation, individual x402 payments do not require repeated wallet popups.

---

## 4. Version One Agent Tools

Version one contains exactly three tools:

### 4.1 Evidence Quality Check

- **Service identifier:** `evidence-quality-check`
- **Price:** $0.01 USDC
- **Purpose:** Assess completeness, relevance, specificity, consistency, and review readiness.

### 4.2 Case Refresh

- **Service identifier:** `case-refresh`
- **Price:** $0.01 USDC
- **Purpose:** Rebuild the case snapshot after meaningful evidence or payment-state changes and update the agent plan.

### 4.3 Dispute Brief

- **Service identifier:** `reclaim-dispute-brief-v1`
- **Price:** Uses the canonical configured price (default $0.01 USDC, configurable via `X402_DISPUTE_BRIEF_PRICE`)
- **Purpose:** Produce a neutral reviewer-ready case packet once the case is sufficiently complete.

Refund Eligibility Scan is not included in V1.

No additional paid tools will be invented during implementation.

---

## 5. Agent Loop

The autonomous loop is:

```
Observe
→ Plan
→ Select one action
→ Enforce policy
→ Execute
→ Persist
→ Reassess
→ Continue, wait, or stop
```

Example run:

1. Read the agreement and escrow state.
2. Detect that evidence is weak.
3. Purchase Evidence Quality Check.
4. Persist settlement and assessment.
5. Create a targeted in-app evidence request.
6. Enter `waiting_for_evidence`.
7. Detect a meaningful evidence update.
8. Purchase Case Refresh.
9. Update the plan.
10. Determine that the case is review-ready.
11. Purchase Dispute Brief.
12. Persist the final reviewer packet.
13. Enter `ready_for_human_review`.
14. Stop.

The agent must not buy another tool merely because time passed.

Every paid action must be connected to a real case need or a meaningful case-version change.

---

## 6. Agent Authority

### The agent may autonomously:

- read case information;
- plan;
- revise its plan;
- purchase allowlisted x402 services;
- create evidence requests;
- wait for case updates;
- resume after updates;
- prepare neutral reports;
- maintain an audit trail.

### The agent may not:

- exceed the approved budget;
- use non-allowlisted tools;
- send funds to arbitrary recipients;
- access or move escrow funds;
- decide which party wins;
- release, refund, or split escrow funds;
- open irreversible contract actions without human authorization;
- expose or transmit wallet secrets.

---

## 7. Case Wallet Security

Each payment case receives a unique wallet.

The private key must be:

- generated server-side;
- encrypted immediately;
- stored only as ciphertext;
- decrypted only inside the secure worker;
- excluded from browser responses;
- excluded from logs;
- excluded from error messages;
- excluded from analytics;
- excluded from activity records.

For the hackathon, encryption may use a strong server-only environment-held encryption key.

Production should migrate to managed KMS/HSM custody.

The case wallet may only participate in:

- official Celo Mainnet x402 facilitator payments;
- registered Reclaim payTo payments;
- allowlisted service prices;
- spending within its remaining budget;
- returning unused USDC to the original funder through Close and reclaim.

---

## 8. Persistent Memory

Supabase-backed agent memory stores:

- agent ID;
- payment identity;
- fixed goal;
- current state;
- current plan;
- concise observations;
- unresolved evidence gaps;
- evidence-version hash;
- case-version hash;
- allowed tools;
- approved budget;
- spent budget;
- remaining budget;
- case-wallet address;
- encrypted case-wallet secret;
- original funder/refund wallet;
- tool executions;
- x402 settlement details;
- evidence requests;
- approval requests;
- retry/recovery information;
- expiry;
- created, updated, activated, paused, and closed timestamps.

Visible reasoning is limited to concise action reasons and audit records.

Hidden chain-of-thought is not stored or exposed.

---

## 9. Agent States

| State | Description |
|---|---|
| `draft` | Agent record created, not yet configured |
| `awaiting_funding` | Wallet created, waiting for USDC deposit |
| `funded` | Budget received, awaiting activation |
| `awaiting_activation` | Pre-activation review displayed |
| `active` | Autonomous loop running |
| `running_tool` | Executing one x402 service purchase |
| `waiting_for_evidence` | Paused until meaningful evidence change |
| `waiting_for_human_approval` | Paused pending human decision |
| `ready_for_human_review` | Brief produced, awaiting human judgment |
| `budget_exhausted` | Budget depleted before completion |
| `expired` | Case exceeded its expiry |
| `paused` | User manually paused |
| `closing` | Close and reclaim in progress |
| `closed` | Case wallet reclaimed, permanently inactive |
| `failed_recoverable` | Transient error, retry possible |

State transitions are explicit and validated.

---

## 10. Worker Safety

The scheduled server worker processes one safe action per iteration.

Each run:

1. Acquires an exclusive database lock or lease.
2. Confirms the agent is active.
3. Confirms it is not expired, paused, closing, or closed.
4. Reads the latest payment and evidence state.
5. Calculates the current case/evidence version.
6. Updates the plan.
7. Selects at most one next action.
8. Enforces tool, recipient, price, and budget policies.
9. Executes or enters a waiting state.
10. Persists the result.
11. Releases the lock.

Concurrent workers must not execute duplicate x402 settlements.

Previously settled service requests must be recovered without another payment.

---

## 11. Evidence Requests

The agent may automatically create in-app evidence requests.

Examples:

- upload the final live URL;
- provide a timestamped delivery screenshot;
- explain how a submitted file relates to the agreed deliverable;
- provide the relevant revision record.

Each request identifies:

- the party responsible;
- the missing item;
- why it is needed;
- its status;
- when it was created;
- whether the case changed after fulfillment.

The agent enters `waiting_for_evidence` until the requested information produces a meaningful case-version change.

---

## 12. Close and Reclaim

Only the original funder may initiate Close and reclaim.

The flow:

1. Pause the agent.
2. Block new tool purchases.
3. Ensure no tool execution is still being settled.
4. Determine the unused USDC balance.
5. Return unused USDC only to the original funder wallet.
6. Persist the return transaction.
7. Disable future use of the case wallet.
8. Mark the agent `closed`.

Cases are not automatically closed while valid work is pending.

---

## 13. Control Room

The Payment Room contains a Resolution Agent control section showing:

- fixed goal;
- status;
- current plan;
- current action;
- approved budget;
- spent and remaining budget;
- case wallet;
- allowed tools and prices;
- evidence requests;
- x402 tool purchases;
- tool results;
- approval boundaries;
- activity history;
- Start Resolution Agent;
- Pause;
- Close and reclaim.

It uses the existing Reclaim Proof Ledger design language.

It does not look like a generic chatbot or neon DeFi dashboard.

---

## 14. Success Criteria

The completed V1 must demonstrate:

- one high-level user goal;
- one bounded case budget;
- one activation approval;
- autonomous planning;
- autonomous tool selection;
- autonomous x402 signing and settlement;
- persistence after browser closure;
- automatic waiting for evidence;
- automatic resumption after meaningful change;
- plan revision;
- duplicate-payment prevention;
- recoverable post-payment failures;
- a visible audit trail;
- a final `ready_for_human_review` state;
- no autonomous escrow settlement decision.
