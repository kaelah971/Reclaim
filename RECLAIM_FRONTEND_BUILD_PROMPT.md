# RECLAIM FRONTEND BUILD PROMPT

## Role

Build the complete frontend UI and UX for **Reclaim**, a protected cUSD payment layer for clients and independent digital workers.

This phase is frontend-only. Build every page, route, responsive layout, form, state, and reusable component before integrating wallets, contracts, Supabase, x402, AI, uploads, voting, or settlement.

## Source of truth

Read these files fully before coding:

```text
/DESIGN.md
/docs/reclaim-brand-messaging.md
/docs/reclaim-product-idea.md
```

Use them as follows:

- `DESIGN.md`: colors, typography, spacing, layout, components, responsive behavior, and The Proof Ledger visual system.
- `docs/reclaim-brand-messaging.md`: all site copy, terminology, voice, CTAs, status language, and positioning.
- `docs/reclaim-product-idea.md`: pages, routes, product flows, roles, Payment Room structure, evidence, disputes, reviews, receipts, and refund scanner scope.

Do not invent a different brand, generic copy, or old naming.

## Product identity

Product name:

```text
Reclaim
```

Do not use `Reclaim Express`.

Primary tagline:

```text
Pay with proof.
```

Core promise:

```text
Move money without giving up your recourse.
```

One-line description:

```text
Reclaim protects cUSD payments between clients and independent workers with clear terms, delivery evidence, fair review, and on-chain settlement.
```

Primary CTA:

```text
Protect a payment
```

Approved supporting lines:

```text
Clear terms. Protected funds.
Work delivered. Money released.
When trust is not enough, use terms and proof.
AI prepares the case. People decide.
A fair record for every payment.
```

Lead with protected commerce. Do not lead with DeFi, dispute, recovery, escrow technology, blockchain mechanics, or AI novelty.

## Technical constraints

Use the existing project stack and package manager. Intended stack:

```text
SvelteKit
TypeScript
Tailwind CSS
```

Do not replace the framework or restructure unnecessarily.

Use semantic HTML, typed Svelte components, accessible forms, keyboard navigation, visible focus states, minimum 44×44px touch targets, mobile-first layouts, and `prefers-reduced-motion`.

Keep dependencies minimal.

## No mock product data

Do not create fake:

- users
- wallet addresses
- balances
- transaction hashes
- payments
- disputes
- receipts
- x402 activity
- reviewer rewards
- metrics
- blockchain confirmations
- dashboard activity

Use intentional empty states, first-use states, onboarding states, disabled controls, loading skeletons, unavailable-integration notices, and unknown-record states.

The landing page may show a structural Payment Room preview, but label it clearly as:

```text
Payment Room preview
```

Do not present example content as live data.

## Functionality boundaries

Do not implement:

- real wallet connection or signing
- Celo calls
- cUSD balances
- contract calls
- escrow transactions
- Supabase
- authentication
- file storage
- evidence hashing
- x402 settlement
- AI calls
- vote submission
- settlement execution
- indexing
- receipt verification
- real persistence

Wallet buttons must exist where needed, but must not simulate connection.

On click, show:

```text
Wallet connection will be enabled during Celo integration.
```

Never generate fake addresses, balances, network status, or transaction completion.

## Design direction

Reclaim’s design concept is:

```text
The Proof Ledger
```

The product should feel like a calm, shared agreement. It must not look like a bank dashboard, dark DeFi terminal, legal case system, generic AI dashboard, crypto casino, trading app, or admin template.

Core lifecycle:

```text
Terms → Funds → Delivery → Evidence → Resolution → Receipt
```

Use the **Accord Line** as a restrained visual connector. It must feel like an agreement timeline, not a blockchain chain.

## Visual system

Use the tokens from `DESIGN.md`:

```text
Primary espresso: #231C15
Page warm ivory: #F5EFE4
Hero soft cream: #F2EBDD
Surface white: #FFFFFF
Utility espresso: #3A2E22
Ink: #1E1A15
Muted taupe: #8A7F6E
Antique gold: #B4884A
Gold on dark: #C9A050
Success green: #4C8A5E
Border sand: #E4D9C6
Input sand: #F7EFE2
```

Do not introduce purple gradients, bright blue, neon green, glassmorphism, glowing cards, chrome, decorative coins, chain graphics, or oversized shields.

Use antique gold sparingly. Use green only for protected, verified, released, settled, or confirmed states. Never rely on color alone.

Typography:

```text
Newsreader → marketing display, agreement titles, Payment Room titles, receipt titles
Georama → navigation, forms, labels, buttons, UI, body copy, helper text, statuses
IBM Plex Mono → cUSD amounts, dates, deadlines, IDs, transaction references
```

Use tabular numerals for money, dates, percentages, and IDs.

## Global shells

### Marketing shell

Navigation:

```text
Reclaim
How it works
For clients
For workers
Developers
Sign in
Protect a payment
```

Include a restrained utility line:

```text
Protected cUSD payments on Celo
```

### Product shell

Navigation:

```text
Overview
Payments
Reviews
Receipts
Refund scan
```

Include wordmark, active route, responsive navigation, placeholder wallet button, and mobile navigation.

The UI may support Client, Worker, and Reviewer perspectives for design review, but must not create fake sessions.

## Required routes

Public:

```text
/
/how-it-works
/for-clients
/for-workers
/developers
/sign-in
```

Product:

```text
/dashboard
/payments
/payments/new
/payments/[paymentId]
/payments/[paymentId]/evidence
/payments/[paymentId]/dispute
/disputes/[disputeId]
/reviews
/reviews/[disputeId]
/receipts
/receipts/[receiptId]
/refund-scan
```

Also create framework-appropriate error and not-found pages.

# Route requirements

## `/` Landing page

Hero:

```text
Pay with proof.
```

Support:

```text
Protect cUSD payments with clear terms, delivery evidence, fair review, and on-chain settlement.
```

CTAs:

```text
Protect a payment
See how it works
```

Show a labeled Payment Room preview with:

- cUSD amount
- deliverable
- funds state
- deadline
- evidence expectation
- Accord Line
- next-action area

Trust strip:

```text
Terms agreed
Funds protected
Evidence recorded
Settlement visible
Mobile ready
```

Problem statement:

```text
A wallet transfer proves money moved. It does not prove what was promised.
```

How it works:

```text
Define terms
Protect funds
Deliver work
Submit proof
Resolve fairly
Record settlement
```

Balanced audience messages:

```text
Pay only under terms both sides can see.
Prove delivery and receive a fair release.
```

AI disclosure:

```text
AI prepares the case. People decide. The contract settles.
```

Explain x402 actions without making x402 the main benefit:

- Terms Risk Check
- Evidence Strength Check
- Dispute Packet

Final CTA:

```text
Protect the agreement behind the payment.
```

## `/how-it-works`

Explain:

```text
1. Define the payment
2. Review the terms
3. Deposit cUSD
4. Accept the agreement
5. Submit delivery evidence
6. Approve or dispute
7. Review the case
8. Settle and record
```

Cover responsibilities, privacy, off-chain evidence, AI limits, human review, contract settlement, and receipts.

## `/for-clients`

Core job:

```text
Hold my funds safely until I receive what was agreed.
```

Cover clear deliverables, escrow, evidence review, approval, dispute, and readable outcome.

CTA: `Protect a payment`.

## `/for-workers`

Core job:

```text
Let me prove I delivered and get paid fairly.
```

Cover proof of funds, agreed terms, delivery evidence, release request, neutral review, and visible settlement.

CTA: `Ask a client to use Reclaim`.

Do not generate a fake share link. Show an integration notice instead.

## `/developers`

Show planned integration surfaces:

```text
Protected payment links
Checkout component
Escrow lifecycle API
x402 Terms Risk Check
x402 Evidence Strength Check
x402 Dispute Packet
Settlement receipts
```

Label them `Planned integration surface`.

Do not show fake API keys, responses, or usage.

## `/sign-in`

Headline:

```text
Your wallet opens your Payment Rooms, reviews and receipts.
```

Show wallet button, Celo explanation, privacy note, and no-password explanation. Do not simulate connection.

## `/dashboard`

Headline:

```text
Your protected payments
```

Sections:

```text
Action required
Active payments
Reviews
Recent receipts
```

Empty state:

```text
No protected payments yet.

Create a Payment Room to define the work, protect the funds and keep one shared record.
```

Onboarding:

```text
Connect a wallet
Create clear terms
Deposit cUSD
Share the Payment Room
```

Do not show fake totals.

## `/payments`

Include heading, create CTA, filters, and intentional empty states.

Filters:

```text
All
Action required
Awaiting acceptance
Delivery submitted
Under review
Settled
```

Filters may update empty-state copy, but must not generate records.

## `/payments/new`

Build the complete protected payment form.

Fields:

```text
Client wallet
Worker wallet
Amount in cUSD
Deliverable title
Deliverable description
Delivery format
Delivery deadline
Release rule
Auto-release rule
Dispute window
Evidence expectation
Platform fee disclosure
```

Sections:

- Payment
- Work agreement
- Protection rules
- Review

Show:

```text
Connect your wallet before this payment can be funded.
```

Optional action:

```text
Check these terms — 0.01 cUSD
```

Do not generate a fake report.

Final CTA:

```text
Continue to deposit
```

Local validation is allowed. Do not persist a real payment.

## `/payments/[paymentId]` Payment Room

This is the strongest product page.

Unknown IDs must show:

```text
This Payment Room is not available yet.

Connect the payment service or create a new protected payment once integration is enabled.
```

Build reusable sections for:

- sticky money-state strip
- cUSD amount
- state
- deadline
- next responsible party
- agreement summary
- client
- worker
- deliverable
- release rule
- dispute window
- evidence expectation
- fee
- one primary action per state
- Accord Line
- evidence map
- AI case packet
- receipt section

Future actions supported visually:

```text
Review terms
Deposit cUSD
Accept terms
Submit delivery
Request release
Approve release
Open dispute
View settlement
```

Accord Line stages:

```text
Terms
Funds
Delivery
Evidence
Resolution
Receipt
```

Evidence states:

```text
Submitted
Missing
Disputed
Verified
```

AI note:

```text
AI organised the claims and evidence. It did not decide the outcome.
```

On mobile, keep the money state visible and the primary action thumb-accessible.

## `/payments/[paymentId]/evidence`

Build UI for:

- local file selection
- pasted text
- external reference
- description
- evidence type
- related claim
- date
- preview

Do not upload. After local selection, show filename, type, and size only.

Copy:

```text
Files will remain private and off-chain. A verification reference will be recorded when integration is enabled.
```

Optional action:

```text
Check evidence strength — 0.01 cUSD
```

Keep inactive.

## `/payments/[paymentId]/dispute`

Build a calm dispute form with:

- reason
- expected outcome
- disputed deliverable portion
- evidence
- attempted resolution
- context

Explain frozen funds, evidence submission, AI preparation, human review, contract settlement, and possible outcomes.

Outcomes:

```text
Client wins
Worker wins
Split settlement
```

Do not create a fake dispute.

## `/disputes/[disputeId]`

Build:

- payment summary
- client claim
- worker claim
- shared timeline
- evidence inventory
- missing evidence
- contradictions
- unresolved questions
- review progress
- outcomes

Prominently show:

```text
AI prepares the case. People decide. The contract settles.
```

Unknown IDs need unavailable-record state.

## `/reviews`

Empty state:

```text
Assigned cases will appear here when reviewer access is enabled.
```

Show principles:

- review agreed terms
- rely on evidence
- avoid assumptions
- choose client, worker, or split
- do not treat AI output as a ruling

No fake assignments.

## `/reviews/[disputeId]`

Build reviewer workspace:

- case summary
- terms
- client claim
- worker claim
- timeline
- evidence
- contradictions
- unanswered questions
- vote controls

Vote options:

```text
Client wins
Worker wins
Split settlement
```

For split, use two percentage inputs that must total 100%.

Do not submit votes or show fake rewards.

## `/receipts`

Empty state:

```text
No settlement receipts yet.

Receipts appear after a protected payment is released or resolved.
```

Explain future receipt contents.

## `/receipts/[receiptId]`

Build a document-style receipt with:

- outcome
- plain-language settlement
- allocation
- client and worker
- original agreement
- Accord Line
- evidence references
- reviewer result
- transaction references
- verification link
- print/share actions

Do not charge users to understand their own receipt.

Unknown IDs need unavailable-record state.

## `/refund-scan`

Keep secondary.

Headline:

```text
Check a payment record for common billing problems.
```

Support local CSV selection, manual entry, format guidance, and validation states.

Issue labels:

```text
Duplicate charge
Subscription increase
Unexpected fee
```

Do not generate fake findings.

Initial state:

```text
No transactions scanned yet.
```

Future action:

```text
Prepare a recovery package — 0.02 cUSD
```

Keep inactive.

## Reusable components

Create:

```text
AppHeader
MarketingHeader
MobileNavigation
Footer
UtilityBar
WalletButton
RoleSelector
PageHeading
EmptyState
StatusBadge
MoneyStateStrip
AgreementSummary
AccordLine
TimelineStep
TermsBlock
EvidenceMap
EvidenceItem
AICasePacket
ClaimPanel
ReviewerVotePanel
SettlementReceipt
TransactionReference
X402ActionCard
ConfirmationDialog
BottomActionBar
LoadingSkeleton
InlineNotice
ErrorState
UnavailableRecordState
```

Do not hardcode live-looking records into components. Pass record content through props.

## UI states

Design:

```text
Idle
Hover
Focus
Disabled
Validation error
Submitting
Loading
Success
Warning
Destructive confirmation
Unavailable integration
Empty
Unknown record
Offline
Request failure
```

Do not use `alert()`.

## Copy rules

Use `docs/reclaim-brand-messaging.md`.

Voice:

- calm
- exact
- fair to both sides
- human before technical
- honest about AI
- firm around money and deadlines

Use:

```text
protected payment
Payment Room
terms
funds protected
delivery
evidence
review
settlement
receipt
cUSD
shared record
```

Avoid:

```text
refund miracle
win your case
crypto revolution
trustless magic
frictionless
degen
guaranteed
automated justice
AI judge
chargeback killer
```

Never frame either party as guilty by default.

## Responsive checks

Test:

```text
320px
375px
430px
768px
1024px
1440px
```

Requirements:

- no horizontal overflow
- no clipped content
- forms stack correctly
- long addresses truncate safely
- sticky actions do not cover content
- mobile navigation is keyboard accessible
- evidence controls are touch-friendly
- receipt pages print cleanly
- no hover-only interactions

## Accessibility

Meet WCAG AA.

Include semantic headings, labels, visible focus, keyboard navigation, accessible dialogs, useful errors, text plus color for status, reduced motion, `aria-current`, `aria-disabled`, and proper button/link semantics.

## Build order

### F1 — Foundation

Build design tokens, fonts, global styles, shells, headers, footer, navigation, wallet placeholder, buttons, fields, dialogs, notices, empty states, errors, loading skeletons, Accord Line, and shared components.

Acceptance: global UI works on mobile and desktop; build and type-check pass.

### F2 — Marketing

Build:

```text
/
/how-it-works
/for-clients
/for-workers
/developers
/sign-in
```

Acceptance: approved copy, working navigation, no fake live data, responsive layouts, build passes.

### F3 — Payment experience

Build:

```text
/dashboard
/payments
/payments/new
/payments/[paymentId]
/payments/[paymentId]/evidence
/payments/[paymentId]/dispute
```

Acceptance: complete forms, local validation, intentional empty states, strong Payment Room, unknown IDs handled, build passes.

### F4 — Resolution

Build:

```text
/disputes/[disputeId]
/reviews
/reviews/[disputeId]
/receipts
/receipts/[receiptId]
```

Acceptance: AI boundary visible, review UI complete but inactive, receipt complete, unknown IDs handled, build passes.

### F5 — Secondary and QA

Build refund scanner, error pages, not-found page, responsive refinement, accessibility refinement, dead-link review, and final verification.

Acceptance: all routes exist, no fake records, no dead links, no overflow, lint/type-check/build pass.

## Final report

Provide:

1. Route list.
2. Component inventory.
3. Files created.
4. Files changed.
5. Packages installed.
6. Copy decisions from the messaging file.
7. Functionality intentionally unimplemented.
8. Mobile checks.
9. Accessibility checks.
10. Build result.
11. Type-check result.
12. Lint result.
13. Blockers or source-file conflicts.

Run the available equivalents of:

```bash
npm run check
npm run lint
npm run build
```

Use the existing package manager.

## Final acceptance criteria

The frontend passes only when:

- every required route exists
- desktop and mobile navigation work
- approved Reclaim copy is used
- no fake live product data exists
- wallet buttons do not simulate connection
- all forms are complete and responsive
- empty states feel intentional
- Payment Room is the strongest page
- Accord Line is consistent
- AI remains subordinate to evidence and human review
- receipts are readable and document-like
- unknown records are handled
- no dead links remain
- lint, type-check, and build pass
- the product feels like one coherent Reclaim experience
