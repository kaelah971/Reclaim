# DEMO_SCRIPT.md — Reclaim 2–3 minute demo recording

**Goal:** Show the real, completed, on-chain case end-to-end. Every screen,
transaction, and number below already exists in production. **No fake
interactions, no fake transactions, no extra payments.**

Target length: **2:00 – 3:00**. Narration lines are written to be spoken as-is.

Recording tips:
- Use the live site: `https://reclaim-kaelah-s-projects.vercel.app`
- A 1920×1080 (or 1440p) window, full-screen browser.
- Read the narration slowly; pause 1–2 s after each click.
- Do not connect a wallet in the demo unless showing the review page — see step 8.
- No new payments: Payment #1 is already released; the receipt already exists.

---

## Script

### 1. Homepage (0:00 – 0:20)
**Screen:** `https://reclaim-kaelah-s-projects.vercel.app` — headline
"Every payment, carried with proof.", the three buttons, the proof-card stack.

**Narration:**
> "Reclaim — pay with proof. Payments get protected in on-chain escrow with
> locked terms, the worker delivers and submits evidence, and a Resolution
> Agent prepares the case for fair human review. Then a person decides, and the
> contract settles — with a receipt both sides can trust."

**Action:** Click **"Explore the live demo case"** (→ `/payments/1`).

### 2. Payment #1 — completed live case (0:20 – 0:45)
**Screen:** `/payments/1` — payment room showing **Released** state, terms
("Controlled dispute test", buyer-approval release rule, $0.01 USDC), the
evidence reference, and the buttons (Review case, Receipt).

**Narration:**
> "This is the live demo case — a real payment that already went through the
> whole lifecycle on Celo Sepolia. It was funded into the ProtectedPaymentEscrow
> contract, the worker delivered and submitted evidence, and the on-chain state
> now shows Released. Nothing here is mocked: the escrow contract is verified
> and every proof links to the explorer."

**Action:** Scroll through the agreement terms; pause on the evidence reference.

### 3. Evidence (0:45 – 1:00)
**Screen:** `/payments/1/evidence` — the submitted evidence card (title, pasted
text, claim, date) and the on-chain evidence reference
`0x1bb11c9d…abb99` with its explorer link.

**Narration:**
> "The worker submitted this evidence and its hash was committed on-chain in
> the escrow contract — see the evidence reference. The submission transaction
> is verifiable on Blockscout: `submitEvidenceHash` was called by the worker
> wallet."

### 4. Resolution Agent (1:00 – 1:25)
**Screen:** `/payments/1/agent` — Agent Control Room showing the agent
`agt_f1f9a3f6-…`, its objective **"Prepare this payment case for fair human
review."**, the observed escrow state, and the paid tool execution
(`evidence-quality-check`, settled).

**Narration:**
> "The Resolution Agent runs per case with its own wallet. Its objective is
> exactly this: prepare this payment case for fair human review. It observed
> the on-chain state, ran one paid service — an evidence-quality check — and
> recorded the settlement proof."

**Action:** Click **"Review case"** (→ `/payments/1/review`).

### 5. Real $0.01 x402 QC settlement (1:25 – 1:40)
**Screen:** the review page's quality-check block — `$0.01 USDC`, network
**Celo Mainnet**, facilitator `api.x402.celo.org`, and the settlement
transaction link `0x5f28527fff…dae351`.

**Narration:**
> "The quality check was paid for with a real x402 payment — one cent of USDC —
> settled on Celo Mainnet by the official Celo facilitator. Here is the
> settlement transaction. This is the real on-chain proof that counts for
> Track 2: routed through the official facilitator, paid to the registered
> Reclaim wallet."

**Action:** Optionally open the Celoscan link in a new tab and point at the
`TransferWithAuthorization` to the payTo wallet — keep it under 10 seconds.

### 6. Human review packet (1:40 – 2:00)
**Screen:** `/payments/1/review` — reviewer questions, ambiguities,
recommended improvements, and the recorded QC-vs-evidence inconsistencies
(e.g. "QC states there is no pasted text, but verified evidence contains pasted
text.").

**Narration:**
> "The agent turned everything into a neutral review packet — what the evidence
> says, what the quality check found, what a reviewer should look at. It even
> records where the quality check and the verified evidence disagree. Nothing is
> hidden from the reviewer. The agent prepares; it does not decide."

### 7. Approve / release proof (2:00 – 2:20)
**Screen:** the review page's **"Approve release"** section (showing it was the
client who approved) and/or the explorer page for the release transaction
`0x271d62cd…87298` (method `approveRelease`, success, block 32992161).

**Narration:**
> "A person — the client — approved the release. That decision is on-chain:
> `approveRelease` succeeded, and the escrow contract released the funds to the
> worker. The contract executes the human decision. No agent can release or
> refund funds."

### 8. Final receipt (2:20 – 2:45)
**Screen:** `/receipts/1` — the final receipt: protected payment, agreement,
evidence, resolution agent, quality check with settlement hash, human decision,
and explorer audit links for every transaction.

**Narration:**
> "Both sides get this final receipt. It is composed only from verified sources
> — the live escrow state, the on-chain release and evidence transactions, the
> verified evidence metadata, and the agent's durable review packet — with an
> audit link for every step. That's Reclaim: the contract protects the payment,
> the agent prepares the resolution, and people make the final decision."

**Action:** Scroll the receipt top to bottom, then end the recording.

---

## Shot list (summary)

| # | Route / screen | Key visible element |
|---|----------------|---------------------|
| 1 | `/` | Hero + live demo case button |
| 2 | `/payments/1` | **Released** state, terms, evidence reference |
| 3 | `/payments/1/evidence` | Evidence card + on-chain evidence reference |
| 4 | `/payments/1/agent` | Agent objective + settled `evidence-quality-check` |
| 5 | review page QC block | $0.01 USDC, Celo Mainnet, settlement tx `0x5f28527fff…` |
| 6 | `/payments/1/review` | Reviewer questions + recorded inconsistencies |
| 7 | release proof | `approveRelease` tx `0x271d62cd…` (Blockscout) |
| 8 | `/receipts/1` | Full final receipt with audit links |

## Honesty rules
- Only the live production site; only Payment #1; only the real transactions listed above.
- Do not replay, mock, or re-execute anything.
- No wallet connection is required except (optionally) to show the approve
  action — and Payment #1 is already approved, so simply show the proof instead.
- Total: ~2:45, comfortably within 3 minutes.
