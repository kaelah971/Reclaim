# SUBMISSION.md — Reclaim (copy-ready draft for Celo Builders)

**Hackathon:** Agentic Payments and DeFAI Hackathon (`agentic-payments-defai`)
**Track:** Track 2 — Most x402 Payments (`most-x402-payments`)
**Bounties:** `most-x402-payments-1st` ($700 CELO) · `most-x402-payments-2nd` ($300 CELO)
**Status:** DRAFT — not published. Missing fields are marked **[MISSING]** below.

> Copy the values below into the Celo Builders submission form. Required fields
> are marked per the official `/submission-fields` schema
> (`requiredAt: registration | submission`). Do not publish until all required
> fields are present.

---

## Official required fields (from celobuilders.xyz — authoritative)

| # | Key | Label | Required at | Value |
|---|-----|-------|-------------|-------|
| 1 | `telegram` | Telegram handle (personal) | registration | `@iamkaelah` |
| 2 | `socialLink` | Twitter/X Submission Link | submission | **[MISSING]** — must be a public X/Twitter post announcing/registering the submission (hosts: x.com, twitter.com). Create and post, then paste the URL here. |
| 3 | `erc8004Url` | 8004 Agent ID URL | submission | **[MISSING]** — no ERC-8004 agent identity registered yet (internal agent id is `agt_f1f9a3f6-b2ab-4719-995f-90a6d7867235`, which is NOT an 8004scan/celoscan agent URL). Register an ERC-8004 agent, then provide `https://8004scan.io/agents/celo/<AGENT_ID>` (or the Celoscan NFT link). |
| 4 | `agentWalletAddress` | Agent Wallet Address | submission | `0x85522bdE267d05bf8CE8813F97c75417b7894A33` (registered Track 2 payTo) |
| 5 | `celoNetwork` | Celo Network | submission | `celo-mainnet` (only allowed option) |
| 6 | `appDomain` | App domain / URL | optional | `https://reclaim-kaelah-s-projects.vercel.app` |
| 7 | `aigoraProfileUrl` | Aigora Profile URL | optional | n/a (Track 4 only) |
| 8 | `aigoraFeedbackIssueUrl` | Aigora Feedback Issue URL | optional | n/a (Track 4 only) |

---

## Base submission fields

### Project name
`Reclaim`

### One-line description (tagline)
`Reclaim — "Pay with proof." Protected payments on Celo with agent-prepared resolution, fair human review, and real x402 settlement.`

### Full description
```
Reclaim is a protected-payment platform on Celo. A client's payment is held in
on-chain escrow with locked terms; the worker delivers work and submits evidence;
a Resolution Agent (objective: "Prepare this payment case for fair human review.")
reads the on-chain state, pays a real x402 service to quality-check the evidence
through the official Celo facilitator, and prepares a durable, neutral review
packet. A person reviews and decides; the contract executes release or refund;
and both sides get a final receipt composed only from verified sources.

The contract protects the payment. The agent prepares the resolution. People
make the final decision.

Every paid agent action settles on Celo Mainnet via the official Celo x402
facilitator (api.x402.celo.org) to the registered payTo wallet. One real
end-to-end case is live: Payment #1 was funded, evidenced, quality-checked
(0.01 USDC x402 settlement), reviewed by a human, released on escrow, and
issued a final receipt.
```

### Live URL (demoUrl)
`https://reclaim-kaelah-s-projects.vercel.app`

### GitHub URL (githubUrl)
`https://github.com/kaelah971/Reclaim` (public)

### Track
- Track slug: `most-x402-payments` (Track 2 — Most x402 Payments)
- Bounty slugs: `most-x402-payments-1st`, `most-x402-payments-2nd`

### Agent / payTo wallet (agentWalletAddress)
`0x85522bdE267d05bf8CE8813F97c75417b7894A33`

### ERC-8004 field/status
- `erc8004Url`: **[MISSING]** — no ERC-8004 agent identity registered.
- Internal resolution-agent id (not an ERC-8004 URL): `agt_f1f9a3f6-b2ab-4719-995f-90a6d7867235`

### x402 proof transaction (real, on-chain)
```
Settlement: https://celoscan.io/tx/0x5f28527fff51fbb8961f6651b1646e3abcb829a4925dcdccf21d948d86dae351
0x5f28527fff51fbb8961f6651b1646e3abcb829a4925dcdccf21d948d86dae351
```
- 0.01 USDC to `0x85522bdE267d05bf8CE8813F97c75417b7894A33`
- Broadcast by the official Celo x402 facilitator signer (`0x0d74D5Cefd2e7F24E623330ebE3d8D4cB45fFB48`)
- Celo Mainnet, block 74360582, 2026-08-09T07:42:20Z, status `success`

Supporting proofs for the same case:
- Release (human-approved) on Celo Sepolia: `0x271d62cd50a1f9d1d2d1495f74be568050cf5a55e98690940840b2d5ec687298`
- Evidence submission: `0xaee6b1de391c39daab71015c8d3d4326ec4b40ff577deca0c7471b9f2b677958`

### Demo video
- `videoUrl`: **[MISSING]** — record the 2–3 min demo following `DEMO_SCRIPT.md`, upload (e.g. YouTube), and paste the URL.

### X/Twitter post (socialLink)
- `socialLink`: **[MISSING]** — must be a public X post announcing/registering the submission (required to publish). Post first, then paste the URL.

### Technical summary
```
Stack: Next.js 16 (App Router) + TypeScript (strict) + Tailwind CSS v4 +
wagmi/viem + Supabase (durable evidence & agent store) + Foundry (escrow).

- ProtectedPaymentEscrow (Solidity, verified) on Celo Sepolia: create → fund →
  accept → deliver/evidence → release request → dispute window → release/refund,
  with on-chain evidence references (submitEvidenceHash).
- Resolution Agent (server-side worker): observe (read-only escrow + verified
  evidence) → plan → execute paid tools → verify → persist durable events
  (review_packet_prepared, payment_settled). Per-case wallet, AES-256-GCM
  encrypted at rest. Stops before any human decision.
- Paid tool evidence-quality-check: deterministic AI quality assessment with
  fallback; executed via x402 v2 against the official Celo facilitator
  (api.x402.celo.org), EIP-3009 TransferWithAuthorization signed by the case
  wallet; accepted only with the facilitator's on-chain settlement proof;
  exactly one settlement per request hash; no silent fallback to local mode.
- Review packet: durable, includes evidence inventory, QC readiness, reviewer
  questions, ambiguities, recommended improvements, and any recorded QC-vs-
  evidence inconsistencies (never hidden).
- Final receipt API (public, read-only): composed from live escrow state,
  on-chain release/evidence proofs, verified evidence metadata, and the review
  packet; includes explorer audit links for every transaction.
- Tests: vitest suites across escrow actions, x402 helpers, receipt, review
  page, agent adapters (payTo lock, facilitator requirements, atomicity).
```

### Celo integration summary
```
- Escrow demo on Celo Sepolia (chain 11142220), USDC
  0x01C5C0122039549AD1493B8220cABEdD739BC44E, canonical contract
  0x1A1CA38D6ac538d491A5c0db2Ed7FDDC3AeC709F (V2).
- Real x402 payments on Celo Mainnet (chain 42220), USDC
  0xcebA9300f2b948710d2653dD7B07f33A8B32118C, through the official Celo x402
  facilitator https://api.x402.celo.org.
- Track 2 payTo enforced in code and tests: 0x85522bdE267d05bf8CE8813F97c75417b7894A33.
- Attribution tag celo_b7de8bf7e64e (registered).
- On-chain proof of concept: one mainnet x402 settlement this hackathon window
  (0x5f28527fff...dae351, 0.01 USDC).
```

---

## Publish checklist (do NOT publish until green)

- [ ] `socialLink` — real public X post URL
- [ ] `erc8004Url` — real ERC-8004 agent identity URL
- [ ] `videoUrl` — real demo video URL
- [ ] Confirm `agentWalletAddress` and `celoNetwork` exactly as above
- [ ] Confirm submission status via `GET /submissions/me` (draft → ready → publish)
