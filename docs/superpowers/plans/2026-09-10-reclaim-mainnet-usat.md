# Reclaim Mainnet USA₮ Protected Payments Implementation Plan

**Design:** `docs/superpowers/specs/2026-09-10-reclaim-mainnet-usat-design.md`
**Date:** 2026-09-10
**Branch:** `ra22-mainnet-protected-payments`
**Status:** Locked plan; planning/documentation only

---

## Goal and Release Priority

Move new protected escrow payments to a Celo Mainnet deployment using USA₮ as
the only escrow token, while keeping Resolution Agent x402 service payments on
USDC and preserving existing Celo Sepolia history.

Release priority:

- **MUST SHIP:** P1 Escrow Safety, P2 Mainnet Config + Integrity, P3 Mainnet
  Deployment + Real E2E.
- **MUST SHIP before AskBots Round 2:** P4 AskBots UX Delta.
- **SHOULD SHIP only after P1–P4 are stable:** P5 Fee Abstraction.

Global constraints:

- Tests are written before implementation in every phase.
- No phase adds multi-token escrow, automatic settlement, or deadline
  enforcement.
- The Resolution Agent never controls escrow funds or decides the winner.
- The existing wallet roles remain unchanged.
- No live signatures, deployment, transaction, production change, database
  migration, or AskBots run occurs without the phase checkpoint explicitly
  approved by the user.

---

## P1 — Escrow Safety

**Priority:** MUST SHIP
**Objective:** Make the escrow state machine safe for a new immutable USA₮
deployment without changing its public ABI, function signatures, or enum
ordering.

### Exact files and functions

- `contracts/src/ProtectedPaymentEscrow.sol`
  - `openDispute(uint256,bytes32)`
  - `fundPayment(uint256)`
  - existing `resolveDispute(uint256,uint256)` terminal behavior
- `contracts/test/ProtectedPaymentEscrow.t.sol`
  - add direct terminal-state and funding-accounting regressions
- `contracts/test/ProtectedPaymentEscrowInvariant.t.sol`
  - include `Resolved` in terminal-state invariants
- `contracts/src/mocks/` or the existing test token fixture
  - use a fee-on-transfer/mock token only for the balance-delta test; do not
    change the production token boundary

### Tests first and expected failures

Write these tests before changing Solidity:

- `testResolvedPaymentCannotBeDisputed`: create, fund, accept, submit evidence,
  dispute, resolve, then expect `openDispute` to revert.
- `testResolvedPaymentCannotBeSettledTwice`: prove a resolved payment cannot
  reach a second resolution and cannot emit a second settlement.
- `testFundPaymentRevertsWhenReceivedAmountDiffers`: use a token that transfers
  less than requested and expect the existing `TransferAmountMismatch`
  behavior.
- `invariantTerminalStatesCannotTransition`: include `Resolved` alongside
  `Released` and `Cancelled`.

Against the current contract, the first two tests fail because `Resolved` is
not rejected by `openDispute`; the funding test fails because the current
implementation does not compare pre- and post-transfer balances.

### Minimal implementation

- Reject `Resolved` in `openDispute` using a positive allowlist of disputeable
  states or an explicit terminal-state guard.
- In `fundPayment`, read the escrow token balance before and after
  `safeTransferFrom`; revert with the existing `TransferAmountMismatch`
  behavior unless the delta equals `p.amount`.
- Preserve the existing function signatures, public events, enum ordering,
  immutable token model, and descriptive term fields.
- Do not add deadline checks, automatic release, or new settlement paths.

### Verification commands

```powershell
Push-Location contracts
forge build
forge test -vvv
Pop-Location
```

The phase passes only when the new regressions and the existing invariant suite
pass. Do not run a broadcast command.

### Commit boundary

Commit only the P1 contract and contract-test changes as:

```text
fix: harden escrow terminal states and funding accounting
```

### Manual checkpoint

No external action is needed for P1. A reviewer must confirm that the ABI,
function signatures, enum ordering, and wallet roles are unchanged before P2.

---

## P2 — Mainnet Config + Integrity

**Priority:** MUST SHIP
**Objective:** Add chain-scoped mainnet USA₮ configuration and close the
reviewer, receipt, authorization, idempotency, evidence, and settlement-proof
integrity gaps without breaking readable Sepolia history.

### Exact files and functions

#### Chain and token configuration

- `src/lib/web3/chains.ts`
  - Celo Mainnet and Celo Sepolia definitions
- `src/lib/web3/config.ts`
  - chain client/RPC selection
- `src/lib/web3/tokens.ts`
  - USA₮ escrow token configuration
- `src/lib/contracts/addresses.ts`
  - chain-scoped escrow addresses; mainnet address is populated only after P3
  - preserve canonical Sepolia V2 address
- `src/lib/contracts/config.ts`
  - `getEscrowContractAddress()` and `getEscrowContractConfig()`
- `src/lib/contracts/types.ts`
  - token-aware payment parsing and exact atomic-unit formatting
- `.env.example`
  - separate escrow network/token variables from x402 USDC variables

#### Escrow hooks and readers

- `src/hooks/contracts/useCreatePayment.ts`
- `src/hooks/contracts/useTokenApproval.ts`
- `src/hooks/contracts/useEscrowActions.ts`
- `src/lib/resolution-agent/api/escrow-reader.ts`
- `src/lib/evidence/chainProvenance.ts`
- `src/lib/evidence/finalReceipt.ts`

#### Reviewer and durable identity

- `src/lib/x402/paymentStore.supabase.ts`
- `src/app/api/reviews/route.ts`
- `src/app/api/reviews/[id]/route.ts`
- `src/app/api/reviews/[id]/submit/route.ts`
- `src/lib/reviewer/auth.ts`
- `src/lib/reviewer/execution/executor.ts`
- `supabase/migrations/00015_mainnet_payment_integrity.sql`

The migration adds the database-backed uniqueness needed for exact duplicate
request identity and indexes the escrow binding without rewriting historical
records. Existing `escrow_payment_id` data is preserved. Escrow-scoped records
must write and validate the existing field; general x402 service records remain
valid without an escrow case.

#### Resolution Agent authorization and execution

- `src/lib/resolution-agent/api/auth.ts`
- `src/lib/resolution-agent/api/service.ts`
- `src/lib/resolution-agent/adapters/recovery.ts`
- `src/lib/resolution-agent/worker/lease.ts`
- `src/lib/resolution-agent/worker/dispatcher.ts`
- `src/lib/resolution-agent/server/reclaim-transfer.ts`
- `src/app/api/resolution-agents/[agentId]/activate/route.ts`
- `src/app/api/resolution-agents/[agentId]/run/route.ts`
- `src/app/api/resolution-agents/[agentId]/resume/route.ts`
- `src/app/api/resolution-agents/[agentId]/renew/route.ts`
- `src/app/api/resolution-agents/[agentId]/pause/route.ts`
- `src/app/api/resolution-agents/[agentId]/close/route.ts`
- `src/app/api/resolution-agents/[agentId]/amend-budget/route.ts`

#### x402 amount and payment binding

- `src/lib/x402/config.ts`
  - keep x402 USDC constants independent of escrow USA₮ constants
- `src/lib/x402/shared.ts`
  - `buildPaymentRequirements()`
  - `verifyPaymentPayload()`
- `src/lib/x402/settlementProvider.facilitator.ts`
  - `verifyPayment()`
  - `settlePayment()`
  - enforce the configured facilitator amount and asset
- `src/lib/x402/settlement.ts`
  - idempotent settlement/recovery handling
- `src/app/api/x402/evidence-check/route.ts`
- `src/app/api/x402/dispute-brief/route.ts`

#### Evidence and receipts

- `src/app/api/payments/[paymentId]/evidence/metadata/route.ts`
  - reject replacement after the agreed submission lock
- `src/app/api/payments/[paymentId]/receipt/route.ts`
  - compose explicit state and verified chain receipts
- `src/lib/evidence/chainProvenance.ts`
  - map `Resolved` to `Resolved`, not `Refunded` or `Released`

### Tests first and expected failures

Write tests before implementation:

- `src/lib/contracts/__tests__/mainnetConfig.test.ts`: assert chain ID `42220`,
  USA₮ address, `USAT` technical symbol, six decimals, and separate Sepolia
  history configuration. It fails until chain-scoped USA₮ config exists.
- `src/lib/x402/__tests__/asset-boundary.test.ts`: assert changing escrow
  config cannot change x402 USDC requirements. It fails if constants remain
  coupled.
- `src/lib/reviewer/__tests__/binding.test.ts`: reject missing or mismatched
  numeric escrow ID, client, worker, amount, token, or chain.
- `src/lib/evidence/__tests__/chainProvenance.test.ts`: assert state `8` is
  `Resolved`.
- `src/lib/evidence/__tests__/finalReceipt.test.ts`: assert every terminal
  state receives the correct status and action language.
- `src/lib/x402/__tests__/idempotency.test.ts`: concurrent identical requests
  produce one durable execution and one settlement attempt.
- `src/lib/resolution-agent/__tests__/auth-boundary.test.ts`: tampered body,
  case, nonce, or expired structured signature is rejected.
- `src/app/api/payments/[paymentId]/evidence/metadata/__tests__/route.test.ts`:
  evidence replacement after lock is rejected.
- `src/lib/reviewer/__tests__/receipt-wait.test.ts`: agent completion is not
  persisted before `waitForTransactionReceipt` succeeds.

Against the current implementation, these tests expose the x402 UUID/numeric
ID fallback, incorrect resolved receipt labels, weak signature matching,
missing body binding, missing amount enforcement, replacement behavior, and
completion-before-receipt behavior.

### Minimal implementation

- Introduce a chain-scoped escrow configuration while leaving x402 configuration
  explicitly USDC-based.
- Persist `escrow_payment_id` at creation of every escrow-scoped x402 record and
  validate it against live escrow data before reviewer submission/execution.
- Add the `00015_mainnet_payment_integrity.sql` migration and use unique
  database conflict handling rather than a check-then-insert race.
- Replace string-inclusion authorization with typed, domain-separated signed
  payloads containing action, agent ID, case identity, body hash, nonce, and
  expiry; authenticate the signing wallet against the agent record.
- Validate facilitator amount, asset, recipient, network, and settlement proof.
- Make settlement and recovery idempotent and wait for chain receipts.
- Lock evidence references once the agreed evidence submission point is
  reached.
- Keep all existing x402 service prices and assets on USDC.

### Verification commands

```powershell
npx vitest run src/lib/contracts/__tests__/mainnetConfig.test.ts src/lib/x402/__tests__/asset-boundary.test.ts src/lib/x402/__tests__/idempotency.test.ts src/lib/reviewer/__tests__/binding.test.ts src/lib/evidence/__tests__/chainProvenance.test.ts src/lib/evidence/__tests__/finalReceipt.test.ts
npm run typecheck
npm run lint
npm run build
```

For the database migration, use the repository's checked-in Supabase
migration workflow, apply migrations to the local test database, and run the
related store migration tests. Do not use `drizzle push`; this repository does
not use a Drizzle schema for these Supabase migrations.

### Commit boundary

Commit P2 as:

```text
feat: wire mainnet usat escrow integrity
```

The commit may include the planned database migration because it is required
for reviewer/idempotency integrity. It must not contain a deployment record
with an unbroadcast address or any production environment change.

### Manual checkpoint

Before P3, the user must approve the exact chain-scoped configuration, confirm
that Sepolia history remains readable, and confirm that x402 remains USDC. No
signature or mainnet money is used in P2.

---

## P3 — Mainnet Deployment + Real E2E

**Priority:** MUST SHIP
**Objective:** Deploy the hardened escrow with USA₮ on Celo Mainnet and prove
one small real protected-payment lifecycle.

### Exact files, functions, and deployment parameters

- `contracts/script/DeployProtectedPaymentEscrow.s.sol`
  - `run()`
  - constructor input `ESCROW_TOKEN_ADDRESS`
- `contracts/foundry.toml`
  - add a named Celo Mainnet RPC endpoint without changing Sepolia
- `contracts/deployments/celo-mainnet.json`
  - create only from verified broadcast output
- `src/lib/contracts/addresses.ts`
  - add the resulting mainnet escrow address after deployment
- `src/lib/contracts/config.ts`
  - select the mainnet deployment for new mainnet payments
- `src/lib/web3/chains.ts`
  - chain ID, explorer, and RPC selection
- `src/hooks/contracts/useCreatePayment.ts`
- `src/hooks/contracts/useTokenApproval.ts`
- `src/hooks/contracts/useEscrowActions.ts`
- `src/lib/evidence/chainProvenance.ts`
- `src/lib/evidence/finalReceipt.ts`
- `src/lib/reviewer/execution/executor.ts`

Exact deployment inputs:

```text
chainid = 42220
ESCROW_TOKEN_ADDRESS = 0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771
deployer/constructor owner = 0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486
escrow token decimals = 6
```

The script has no separate owner parameter; `ProtectedPaymentEscrow` uses
`Ownable(msg.sender)`. The broadcast account must therefore be the exact
owner/resolver above. The worker remains
`0x85522bdE267d05bf8CE8813F97c75417b7894A33`, and the Resolution Agent case
wallet remains `0x22bf4271a3f8f3c6885c0d2c825f06f9c9d7f72a`.

### Tests first and expected failures

Write tests before any broadcast:

- `contracts/test/ProtectedPaymentEscrow.t.sol`: full release and dispute/
  resolve paths pass with the P1 invariants.
- `src/lib/contracts/__tests__/deploymentConfig.test.ts`: the deployment
  manifest identifies chain `42220`, USA₮, six decimals, and the required
  owner. It fails until the mainnet configuration is deliberately populated.
- `src/lib/e2e/__tests__/mainnetProtectedPaymentFlow.test.ts`: against a
  configured test client, assert create → fund → accept → evidence → review →
  human release uses the mainnet chain/token and preserves attribution. It
  fails until the runtime uses the new chain-scoped deployment.
- `src/lib/e2e/__tests__/disputeResolveFlow.test.ts`: assert dispute and
  resolution are correct and cannot settle twice.
- `src/lib/contracts/__tests__/attributionMainnet.test.ts`: every
  Reclaim-controlled mainnet write includes the existing attribution suffix.

### Minimal implementation

- Add the mainnet deployment/config wiring without changing Sepolia readers.
- Run the deployment script only after the manual checkpoint below.
- Record the deployed contract address, constructor token, deployer/owner,
  chain ID, deployment transaction, and source verification in
  `contracts/deployments/celo-mainnet.json`.
- Use the existing approval/funding flow for a first real amount between
  `$0.01` and `$0.10` USA₮.
- Execute the real happy path:

```text
create → approve → fund → accept → submit evidence
→ human review → approve release → receipt
```

- Verify final on-chain balances, escrow state, payment token, transaction
  receipts, explorer links, review binding, receipt labels, and attribution.
- Keep dispute/resolve correctness in automated tests. Do not create an
  unnecessary real-money dispute transaction unless the user explicitly
  authorizes one.

### Verification commands

Local verification before broadcast:

```powershell
Push-Location contracts
forge build
forge test -vvv
Pop-Location
npm run typecheck
npm run lint
npm run build
```

After an explicit deployment approval, the deployment command uses the named
mainnet RPC and the already configured deployer secret:

```powershell
Push-Location contracts
forge script script/DeployProtectedPaymentEscrow.s.sol:DeployProtectedPaymentEscrow --rpc-url celo-mainnet --broadcast
Pop-Location
```

After the broadcast, verify read-only:

```powershell
cast call <MAINNET_ESCROW_ADDRESS> "escrowToken()(address)" --rpc-url celo-mainnet
cast call <MAINNET_ESCROW_ADDRESS> "owner()(address)" --rpc-url celo-mainnet
cast code 0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771 --rpc-url celo-mainnet
```

The real E2E must additionally confirm the USA₮ balance deltas and all
transaction receipts from the application. The commands above are recorded
for the future checkpoint and are not run by this documentation task.

### Commit boundary

Commit deployment/config and E2E wiring after the user-approved broadcast and
verification as:

```text
feat: launch mainnet usat protected payments
```

The deployment manifest and address are committed only after they match the
verified broadcast. Sepolia deployment artifacts remain untouched.

### Manual checkpoint

This phase has two mandatory user checkpoints:

1. **Before deployment:** approve the contract source, exact USA₮ address,
   chain ID, deployer/owner address, RPC, and broadcast command.
2. **Before real E2E:** approve the exact first amount (`$0.01–$0.10` USA₮),
   client, worker, evidence action, and human release signature.

No deployment, signature, or transaction occurs before those approvals.

---

## P4 — AskBots UX Delta

**Priority:** MUST SHIP before AskBots Round 2
**Objective:** Address the frozen Round-1 clarity findings without changing
the protected-payment lifecycle or running Round 2 in this plan.

### Exact files and functions/components

- `src/app/(marketing)/page.tsx`
  - make `Protect a payment` the only dominant first action
- `src/app/(marketing)/how-it-works/page.tsx`
  - explain the complete lifecycle and participant responsibilities
- `src/app/(product)/payments/new/page.tsx`
  - add the guided preflight before payment entry/confirmation
- `src/app/(product)/payments/[paymentId]/page.tsx`
  - show current money state and next action
- `src/components/payment/OnboardingChecklist.tsx`
  - network, USA₮ balance, allowance, worker, amount, terms, and next step
- `src/components/payment/MoneyStateStrip.tsx`
  - `USA₮`, current state, deadline text, and responsible participant
- `src/components/payment/PaymentTimeline.tsx`
  - terms → wallet → protect → evidence → review → settlement
- `src/components/payment/AgreementPreview.tsx`
- `src/components/payment/AgreementSummary.tsx`
- `src/components/layout/MarketingHeader.tsx`
- `src/components/layout/UtilityBar.tsx`
- `DESIGN.md`
  - reference only; preserve the existing design system and do not rewrite the
    frozen AskBots baseline

### Tests first and expected failures

Write tests before UI implementation:

- `src/app/(marketing)/__tests__/page.test.tsx`: assert the dominant CTA text
  and that static demo values are labeled as examples.
- `src/app/(product)/payments/new/__tests__/page.test.tsx`: assert preflight
  shows Celo Mainnet, USA₮, six-decimal amount guidance, wallet, approval,
  worker, terms, and the next action.
- `src/components/payment/__tests__/MoneyStateStrip.test.tsx`: assert product
  copy uses `USA₮`, while technical metadata may use `USAT`.
- `src/components/payment/__tests__/PaymentTimeline.test.tsx`: assert all
  lifecycle responsibilities are visible.

Against the current UI, these tests expose competing CTA hierarchy, ambiguous
static values, missing preflight guidance, and incomplete lifecycle copy.

### Minimal implementation

- Use one primary CTA per decision area.
- Clearly label static homepage values as examples or previews.
- Put network and USA₮ readiness checks before the first protected-payment
  confirmation.
- State who acts next and when funds become protected or released.
- Follow `DESIGN.md`: warm Proof Ledger presentation, no generic crypto/deFi
  imagery, accessible contrast, and responsive touch targets.
- Do not run AskBots Round 2 as part of this phase.

### Verification commands

```powershell
npx vitest run "src/app/(marketing)/__tests__/page.test.tsx" "src/app/(product)/payments/new/__tests__/page.test.tsx" "src/components/payment/__tests__/MoneyStateStrip.test.tsx" "src/components/payment/__tests__/PaymentTimeline.test.tsx"
npm run lint
npm run build
```

### Commit boundary

Commit the UX delta as:

```text
feat: clarify mainnet protected payment journey
```

### Manual checkpoint

Review the desktop and mobile payment-creation journey manually. Confirm that
the copy says USA₮ for escrow, USDC for Resolution Agent x402 services, and
does not imply automatic settlement. No AskBots call is made.

---

## P5 — Fee Abstraction

**Priority:** SHOULD SHIP only after P1–P4 are stable
**Objective:** Let supported USA₮ escrow transactions pay Celo gas through the
verified USA₮ fee-currency adapter while preserving a working native-CELO or
existing non-abstracted fallback.

### Exact files and functions

- `src/lib/web3/config.ts`
  - fee-currency-aware public client/wallet configuration
- `src/lib/web3/chains.ts`
  - Celo Mainnet fee-currency metadata
- `src/lib/web3/tokens.ts`
  - USA₮ fee adapter constant, distinct from the token contract address
- `src/hooks/contracts/useCreatePayment.ts`
- `src/hooks/contracts/useTokenApproval.ts`
- `src/hooks/contracts/useEscrowActions.ts`
  - pass fee-currency configuration only where the wallet/client supports it
- `src/lib/contracts/attribution.ts`
  - preserve attribution on every Reclaim-controlled write
- `src/lib/x402/config.ts`
  - remain USDC-only; do not apply USA₮ migration here
- `src/lib/resolution-agent/server/reclaim-transfer.ts`
  - preserve the existing x402 USDC asset and its own fee configuration

### Tests first and expected failures

Write tests before implementation:

- `src/lib/web3/__tests__/feeAbstraction.test.ts`: assert USA₮ escrow writes
  use adapter `0x0357EE22278c922e1D36cFe6b899269b161880C4`, not the token
  address. It fails until fee-currency metadata is wired.
- `src/hooks/contracts/__tests__/feeCurrencyFallback.test.tsx`: assert a
  wallet/client without fee-currency support still produces a valid
  non-abstracted transaction path.
- `src/lib/x402/__tests__/feeAssetBoundary.test.ts`: assert x402 remains
  USDC and is not changed by escrow fee abstraction.
- `src/lib/contracts/__tests__/attributionFeeCurrency.test.ts`: assert the
  existing ERC-8021 suffix remains on Reclaim-controlled calldata.

### Minimal implementation

- Add the verified USA₮ adapter as fee-currency metadata for supported mainnet
  escrow writes.
- Detect unsupported wallet/client paths and retain the working fallback that
  requires native CELO.
- Do not alter the hosted x402 facilitator, x402 USDC prices, or x402 asset
  configuration.
- Do not make fee abstraction a prerequisite for the P3 E2E.

### Verification commands

```powershell
npx vitest run src/lib/web3/__tests__/feeAbstraction.test.ts src/hooks/contracts/__tests__/feeCurrencyFallback.test.tsx src/lib/x402/__tests__/feeAssetBoundary.test.ts src/lib/contracts/__tests__/attributionFeeCurrency.test.ts
npm run typecheck
npm run lint
npm run build
```

If a real wallet test is authorized, use a non-settlement smoke transaction
only after confirming the adapter and fallback behavior. Do not repeat or
modify the P3 protected-payment E2E solely to add fee abstraction.

### Commit boundary

Commit P5 separately as:

```text
feat: add usat fee abstraction fallback
```

### Manual checkpoint

The user must approve any wallet signature or mainnet transaction used to
validate fee abstraction. If adapter support is not stable, stop P5 and ship
P1–P4 without allowing it to delay the USA₮ E2E.

---

## Final Release Gate

Before release, confirm:

- `Resolved` is terminal and cannot settle twice.
- `fundPayment` verifies actual USA₮ balance delta.
- New escrow payments use USA₮ only on chain `42220`.
- x402 Resolution Agent payments remain USDC.
- Sepolia history remains readable.
- Numeric escrow IDs and all reviewer identity fields remain bound.
- Facilitator amount, asset, recipient, and settlement proof are validated.
- Agent auth, recovery, evidence locking, and settlement idempotency pass tests.
- Every Reclaim-controlled mainnet write uses `celo_b7de8bf7e64e` through the
  existing attribution plumbing.
- P4 is complete before AskBots Round 2 is considered.
- P5 is not allowed to delay P1–P4.

This plan authorizes no code, database, deployment, transaction, production,
or AskBots change by itself.
