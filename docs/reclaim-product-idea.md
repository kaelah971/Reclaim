# Reclaim — Refined Product Idea

## 1. One-line pitch

**Reclaim is protected checkout for cUSD payments. It lets clients and digital workers agree terms, hold funds in escrow, submit delivery evidence, prepare disputes with AI, and settle outcomes on Celo.**

### Sharper hackathon pitch

> **Reclaim makes cUSD payments recoverable by rules, not blind trust.**

### Final product thesis

> Stablecoin payments will not become everyday commerce until users have a practical way to protect the agreement behind the transfer. Reclaim makes that protection programmable.

---

## 2. What Reclaim is

Reclaim is a plug-and-play protected payment layer for freelancers, remote clients, digital-service sellers, small merchants, marketplaces and crypto-native applications that need safer cUSD payments.

Its main workflow is:

> **Create protected payment → agree terms → deposit cUSD → deliver work → approve or dispute → AI prepares the case → reviewers vote → contract settles → receipt explains the outcome.**

The product is not a refund super-app. Its focused hackathon role is a **protection layer for Celo stablecoin payments**.

### Core promise

You want the speed of global stablecoin payment without accepting total loss when something goes wrong. Reclaim holds cUSD to clear, shared terms and gives both sides evidence and a fair path to resolution.

---

## 3. Problem

Stablecoin payments are fast, low-cost and global, but ordinary commerce needs more than a transfer.

- A client can pay a freelancer who never delivers.
- A freelancer can deliver work and have payment withheld.
- A marketplace can accept stablecoins but lack practical buyer/seller protection.
- Agents may buy or sell services but need explicit rules, proof and bounded settlement authority.

The user complaint is simple:

> “I want the speed of crypto payments without the risk of losing money when something goes wrong.”

Reclaim makes protection a property of the payment itself.

---

## 4. Target users

| User | Pain | Reclaim job |
|---|---|---|
| Client / buyer | Seller may not deliver | Hold funds until agreed work is delivered or a fair review resolves the case |
| Freelancer / seller | Buyer may refuse release after delivery | Submit proof, request release and receive a visible, fair outcome |
| Digital-service seller | Needs trust without card-chargeback uncertainty | Offer protected cUSD checkout |
| Marketplace / app | Needs a payment-protection layer | Plug in protected payment links or API workflows |
| Reviewer / juror | Needs a case that is efficient to assess | Review AI-organised, neutral evidence packet and vote |
| Agent / app developer | Needs paid protection actions | Call x402 endpoints for terms, evidence and dispute workflows |

### Initial wedge

Launch for **clients and independent workers exchanging defined digital deliverables**—for example, a landing page, Figma file, video edit, code feature or content package. The work is concrete enough to set terms and submit proof.

---

## 5. Core product modes

### Mode 1: Protected cUSD Payment — the main product

A buyer creates a protected payment with:

| Field | Example |
|---|---|
| Amount | `100 cUSD` |
| Seller wallet | `0x…` |
| Deliverable | `Landing page Figma file with mobile design` |
| Deadline | `18 July 2026` |
| Release rule | `Buyer approval or auto-release 48 hours after delivery` |
| Dispute window | `24 hours after delivery` |
| Evidence expectation | `Final files, revision record and agreed message thread` |

Lifecycle:

1. Buyer creates terms.
2. Buyer may buy an x402 Terms Risk Check.
3. Buyer deposits cUSD to escrow.
4. Seller reviews and accepts terms.
5. Seller submits delivery evidence.
6. Buyer approves release or opens a dispute.
7. AI prepares a neutral case packet if disputed.
8. Reviewers vote.
9. Contract settles the chosen outcome.
10. Both sides receive a plain-language receipt and verification record.

### Mode 2: x402-paid AI protection actions

Every x402 payment buys a concrete output a person can use.

| Endpoint | Demo price | User receives |
|---|---:|---|
| `/api/x402/risk-check` | `0.01 cUSD` | Terms-risk report: missing deadline, unclear format, vague release rule or incomplete evidence expectation |
| `/api/x402/evidence-check` | `0.01 cUSD` | Evidence-strength report: missing proof, weak file description or timeline conflict |
| `/api/x402/dispute-packet` | `0.03 cUSD` | Neutral reviewer-ready packet: terms, claims, timeline, evidence inventory and unresolved questions |

**Do not charge users to view their own settlement receipt.** A receipt is a trust feature, not an upsell.

### Mode 3: lightweight refund scanner — secondary only

A user uploads a CSV or enters sample transactions. Reclaim flags duplicates, subscription increases or hidden fees, then may sell a recovery-package generation action through x402. This proves the broader payment-protection vision, but it is not the product hero and should be cut if it threatens the main end-to-end payment flow.

---

## 6. Main user flows

### Buyer / client

1. Connect wallet.
2. Select **Protect a payment**.
3. Enter seller wallet, cUSD amount, deliverable, deadline, release rule and evidence expectation.
4. Optionally purchase Terms Risk Check.
5. Amend weak terms.
6. Deposit cUSD into escrow.
7. Send seller the protected-payment link.
8. Review delivery evidence.
9. Approve release or open dispute.
10. If disputed, purchase/prepare neutral case packet.
11. View settlement and receipt.

### Seller / freelancer

1. Open protected-payment link.
2. Review terms, amount, deadline, release rule and evidence expectation.
3. Accept or reject terms.
4. Submit delivery evidence.
5. Request release.
6. If disputed, submit counter-evidence.
7. Receive settlement and readable receipt.

### Reviewer / juror

1. Connect wallet and register as reviewer for the demo.
2. Receive a seeded dispute assignment.
3. Review AI-neutral case packet and underlying evidence.
4. Vote: buyer wins, seller wins or split.
5. View settlement. Optional reward routing is a later priority; reviewers should not pay to access cases.

---

## 7. Dispute outcomes

| Outcome | Settlement |
|---|---|
| Buyer wins | Funds return to buyer |
| Seller wins | Funds release to seller |
| Split | Funds divide by the declared reviewer decision |

For the hackathon, keep only these three outcomes. Fraud slashing, a public juror marketplace, complex legal rule engines and broad chargeback automation are out of scope.

---

## 8. AI agent role and guardrails

The AI does **not** decide who wins.

| Agent task | Purpose |
|---|---|
| Read terms | Identify the actual promise and release condition |
| Build timeline | Show what happened and when |
| Separate claims | Distinguish buyer claim from seller claim |
| Analyse evidence | Flag missing proof, conflict or ambiguity |
| Generate neutral summary | Make reviewer assessment faster and more consistent |
| Explain receipt | Translate on-chain actions into human language |
| Generate recovery package | Create external charge-dispute letter for the secondary scanner mode |

> **AI prepares the case. People vote. The contract settles.**

The user interface must state this explicitly in every dispute packet.

---

## 9. Smart-contract scope

Use one focused contract: `ProtectedPaymentEscrow`.

| Function | Purpose |
|---|---|
| `createPayment` | Create payment terms and state |
| `deposit` | Buyer deposits cUSD |
| `acceptPayment` | Seller accepts terms |
| `submitEvidenceHash` | Store a hash/reference for off-chain evidence |
| `requestRelease` | Seller requests release |
| `approveRelease` | Buyer releases escrow |
| `openDispute` | Freeze payment and enter review state |
| `submitVote` | Reviewer submits outcome vote |
| `executeSettlement` | Move funds according to resolution |
| `cancelExpired` | Handle expired or unaccepted payment |

Keep raw evidence off-chain. Store only hashes/references, wallets, amounts, lifecycle state, timestamps and settlement result on-chain.

A production contract requires a verified resolution model, dispute window, access control, pause mechanism, event emission, invariant/fuzz testing and security review. Do not give an unaudited AI agent unrestricted settlement authority.

---

## 10. Celo and x402 fit

| Requirement | Reclaim fit |
|---|---|
| Real on-chain money movement | cUSD escrow deposit, release, refund/split settlement and transparent fees |
| Stablecoin use | cUSD is the payment and settlement asset |
| x402 payments | Useful paid protection actions, not artificial microtransactions |
| Agentic payments | AI prepares terms/evidence/dispute outputs under bounded authority |
| Global mobile use | A mobile-first protected payment flow for remote work and MiniPay-compatible contexts |
| Beyond prototype | A reusable payment-protection layer for checkout links, apps and marketplaces |

### Track strategy

**Primary:** Most x402 Payments. One real case can naturally trigger two or three useful x402 actions: terms check, evidence check and dispute packet.

**Secondary:** Most Revenue Generated. Escrow deposits and settlement are meaningful cUSD volume, provided all transactions are real, user-approved and tagged according to hackathon requirements.

Use official attribution tags, a registered `payTo` wallet and the approved Celo x402 facilitator exactly as required by the hackathon. Confirm current network, stablecoin and submission requirements from official Celo documentation before deployment.

---

## 11. Hackathon MVP

### Must build

- Mobile-first landing page.
- Wallet connection.
- Celo/cUSD support.
- Create a protected payment.
- cUSD escrow deposit.
- Seller acceptance.
- Evidence upload and stored hash/reference.
- Buyer approval release.
- Open dispute.
- x402-paid Terms Risk Check.
- x402-paid Dispute Packet.
- AI-neutral case summary.
- Seeded reviewer voting.
- Buyer / seller / split settlement.
- Receipt page with transaction references and attribution tag.
- MiniPay-friendly responsive layout.

### Should build only after the core flow works

- Evidence Strength Check.
- Split settlement.
- Reviewer reward routing.
- Basic reputation.
- Lightweight refund-scanner demo.
- ERC-8004 registration and optional Askbots/Aigora material.

### Do not build

- Bank or email integrations.
- Full chargeback automation.
- Public juror marketplace.
- Full DAO arbitration.
- Broad legal rules engine.
- Cross-chain support/CCTP before the Celo payment loop works.
- Multiple unrelated AI agents or an MCP suite that does not improve the demo.

---

## 12. Demo story

A client pays a designer **100 cUSD** for a landing-page design.

1. Client opens Reclaim and creates the protected payment.
2. Client enters deliverable: `Landing page Figma file with mobile design.`
3. Client pays `0.01 cUSD` through x402 for a Terms Risk Check.
4. Reclaim identifies missing deadline and unclear delivery format.
5. Client corrects the terms and deposits `100 cUSD` into escrow.
6. Designer accepts the agreement.
7. Designer submits weak delivery evidence.
8. Client opens a dispute.
9. Client pays for the x402 Dispute Packet.
10. AI creates a neutral summary and evidence timeline.
11. Three seeded reviewers vote.
12. Contract executes a split: `80 cUSD` to the client, `20 cUSD` to the designer.
13. Reclaim shows a clear receipt with the payment lifecycle and transaction references.

This one story proves protected commerce, agent utility, x402 payments, human review and Celo settlement.

---

## 13. Required screens

| Screen | Purpose |
|---|---|
| Landing page | Explain protected cUSD payment in five seconds |
| Dashboard | Show active payments, action required and recent receipts |
| Create payment | Build clear escrow terms before deposit |
| Payment Room | Shared agreement, money state, timeline, evidence and actions |
| Evidence upload | Submit delivery or dispute proof |
| Dispute Room | Claims, evidence map and neutral AI packet |
| Reviewer desk | Review and vote on seeded cases |
| Receipt | Explain result and on-chain record |
| Refund scan | Secondary, lightweight demo only |

---

## 14. Product UX and visual direction

### The Payment Room

The defining product screen. It shows, in order:

1. **Money state:** amount, cUSD, status and deadline.
2. **Terms:** deliverable, release rule, dispute window and evidence expectation.
3. **Next action:** one clear action for the current party.
4. **Shared timeline:** agreement, deposit, acceptance, delivery, evidence, dispute and settlement.
5. **Evidence map:** proof connected to claims.
6. **Receipt:** human-readable Celo verification.

### Visual system: The Proof Ledger

Retain the warm ivory/cream/espresso/gold visual environment supplied in the reference design. Reclaim’s product expression is a calm, document-like agreement rather than a cold financial dashboard.

The central identity asset is the **Accord Line**: a restrained continuous line connecting Terms → Funds → Delivery → Evidence → Resolution → Receipt. It can appear in the timeline, Payment Room status, evidence map and receipt. It is not a blockchain-chain motif.

### Typography

- **Newsreader:** agreement titles, receipt titles and major explanatory moments.
- **Inter:** all functional UI and body copy.
- **IBM Plex Mono:** cUSD amounts, dates, evidence IDs and transaction references.

---

## 15. Final product statement

> **Reclaim is a protected payment layer for Celo. It lets clients and digital workers create cUSD payments with clear terms, evidence collection, AI-assisted dispute preparation, human review and on-chain settlement.**

For users, it removes some of the fear around irreversible stablecoin transfers.  
For Celo, it creates practical stablecoin commerce.  
For x402, it creates repeatable paid protection actions.  
For the hackathon, it demonstrates one complete, working money loop.
