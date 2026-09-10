# Reclaim RA2.2B Mainnet USA₮ Design Specification

**Version:** RA2.2B
**Date:** 2026-09-10
**Branch:** `ra22-mainnet-protected-payments`
**Status:** Locked and approved for implementation planning only

---

## 1. Product Decision

Reclaim will add a Celo Mainnet protected-payment deployment whose immutable
escrow token is USA₮. The protected-payment lifecycle remains the existing
human-readable agreement, escrow, evidence, human review, and final receipt
workflow.

This is an asset and network migration, not a new payment protocol. The
existing Celo Sepolia USDC deployment remains supported and readable for
historical payment rooms, receipts, evidence, and development. New mainnet
protected payments use USA₮ only.

The Resolution Agent remains an observer, planner, evidence requester, and
allowlisted x402 service buyer. It does not decide the winner or control
protected escrow funds.

---

## 2. Locked Payment Boundary

| Surface | Network | Asset | Rule |
|---|---|---|---|
| Protected escrow | Celo Mainnet, chain ID `42220` | USA₮ only | One immutable escrow token; no user token selection |
| Historical escrow | Celo Sepolia, chain ID `11142220` | Existing USDC | Preserve readable history and existing deployment |
| Resolution Agent x402 services | Celo Mainnet | USDC | Keep the official hosted facilitator path unchanged |
| Local/test x402 services | Existing configured networks | USDC | Keep test and service-payment semantics unchanged |
| Celo fee abstraction | Mainnet | USA₮ adapter | Deferred until the base mainnet flow works |

The release does not include token arrays, multi-token escrow, swaps, routers,
bridges, token selection, automatic settlement, deadline enforcement, or a
redesign of `deliveryDeadline`, `autoReleaseSeconds`,
`disputeWindowSeconds`, or `releaseRule`.

USA₮ must not replace the USDC asset used by x402 service prices, facilitator
requirements, case-wallet funding, or unused-budget reclaim. The hosted Celo
facilitator currently explicitly supports USDC and USDT, not USA₮.

---

## 3. Verified Celo and Token Configuration

### Protected escrow

- Network: Celo Mainnet
- Chain ID: `42220`
- Token display name: `USA₮`
- Token contract symbol: `USAT`
- Token address: `0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771`
- Token decimals: `6`
- Fee-currency adapter: `0x0357EE22278c922e1D36cFe6b899269b161880C4`
- Explorer token page: `https://celoscan.io/token/0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771`

The token supports standard ERC-20 approval and transfer operations, EIP-2612
`permit`, and EIP-3009 authorization methods. The base escrow migration uses
the existing approval and `transferFrom` flow. Permit support is not a reason
to add a new transaction path in this release.

### Resolution Agent x402 services

- Network: Celo Mainnet, CAIP-2 `eip155:42220`
- Asset: Celo Mainnet USDC
- USDC address: `0xcEBA9300f2b948710d2653dD7B07f33A8B32118C`
- Decimals: `6`
- Facilitator API: `https://api.x402.celo.org`
- Supported endpoint: `https://api.x402.celo.org/supported`
- Celo x402 documentation: `https://docs.celo.org/build-on-celo/build-with-ai/x402`

The supported endpoint confirms the Celo mainnet exact scheme and signer but
does not advertise USA₮ as a facilitator asset. The Celo x402 documentation
lists USDC and USDT as the hosted facilitator assets. No x402 USA₮ migration is
part of RA2.2B.

### Attribution

All Reclaim-controlled Celo writes continue to use ERC-8021 attribution code
`celo_b7de8bf7e64e`. Facilitator-broadcast x402 transactions remain external
broadcasts and must not be represented as Reclaim-controlled calldata.

---

## 4. Wallet and Authority Mapping

| Role | Address | Authority |
|---|---|---|
| Client in the first protected-payment path | `0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486` | Creates, funds, and approves release for its payment |
| Worker/payee | `0x85522bdE267d05bf8CE8813F97c75417b7894A33` | Accepts work, submits evidence, and requests release |
| Resolution Agent case wallet | `0x22bf4271a3f8f3c6885c0d2c825f06f9c9d7f72a` | Pays allowlisted x402 services in USDC only |
| Escrow owner/resolver | `0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486` | Executes `resolveDispute` after a human decision |
| Registered x402 `payTo` | `0x85522bdE267d05bf8CE8813F97c75417b7894A33` | Receives configured x402 service payments |

The wallet mapping is preserved. RA2.2B does not make the case wallet the
escrow owner, does not give the Resolution Agent escrow authority, and does
not silently replace the registered worker or x402 `payTo` wallet.

The contract constructor derives ownership from `msg.sender`; therefore the
P3 deployment must be broadcast by the owner address above. No private key is
recorded in this specification or in the repository.

---

## 5. Escrow Lifecycle and Required Invariants

The existing lifecycle remains:

```text
Created → Funded → Accepted → DeliverySubmitted
→ ReleaseRequested → Released
                         ↘ Disputed → Resolved
```

The following invariants are mandatory before mainnet deployment:

1. `Resolved` is terminal.
2. `Released`, `Resolved`, and `Cancelled` cannot reopen.
3. No payment can settle twice.
4. `fundPayment` records the amount only when the escrow token balance
   actually increases by the requested amount.
5. The configured escrow token remains immutable and equals USA₮ on the new
   mainnet deployment.
6. The agent cannot call or authorize escrow release, refund, split, or
   dispute resolution.
7. Stored terms remain descriptive. No automatic or deadline-triggered
   settlement is introduced.

The existing `PaymentResolved` event and state value remain the source of truth
for dispute outcomes. Provenance and receipt code must not relabel `Resolved`
as `Refunded` or `Released`.

---

## 6. Mainnet Integrity Requirements

The application must preserve a canonical numeric escrow payment ID through
the entire reviewer path. Every escrow-scoped x402 execution, review packet,
decision, execution record, and receipt must bind:

- numeric `escrow_payment_id`;
- escrow chain ID;
- escrow contract address;
- USA₮ token address;
- client address;
- worker address;
- escrow amount in atomic units.

An x402 payment UUID or `pay_*` identifier is not an escrow payment ID and must
never be passed to `BigInt()` or used as the on-chain payment identifier.

Required security properties:

- facilitator settlement enforces the requested amount, not a client-supplied
  larger or smaller amount;
- duplicate request protection is database-backed, unique, and race-safe;
- recovery signatures bind the exact body, case, nonce, and expiry;
- Resolution Agent routes use structured signature verification rather than
  `signedMessage.includes(...)`;
- Resolution Agent wallet ownership is authenticated for agent operations;
- evidence references cannot be replaced after the agreed submission point;
- settlement execution is idempotent and waits for chain receipts before the
  agent is marked complete.

---

## 7. Receipts, History, and Compatibility

The new mainnet deployment gets its own deployment record and address. The
existing Sepolia V1/V2 addresses and their USDC history remain readable. The
application must select chain, token, contract, and explorer from the payment
record rather than globally interpreting every payment as mainnet USA₮.

Existing payment IDs are not migrated, replayed, or reinterpreted as USA₮.
Mainnet receipts must be composed from verified on-chain state, transaction
receipts, evidence metadata, review decisions, and durable x402 settlement
proofs. A pending, disputed, resolved, refunded, or released outcome must use
its own explicit status and action language.

---

## 8. AskBots Round-1 UX Delta

The frozen baseline in `docs/askbots-round-1-baseline.md` recorded:

- Q1 homepage promise/first action: `8.2/10`;
- Q3 lifecycle explanation: `6.6/10`;
- Q5 overall: `7.3/10`;
- 10 responses, with Round 2 intentionally not run.

RA2.2B UX work addresses only the observed gaps:

- one dominant `Protect a payment` CTA;
- static demo values clearly labeled as examples, not inputs;
- guided `/payments/new` preflight for network, USA₮ balance, approval,
  worker, amount, terms, and next action;
- plain-language explanation of terms → wallet → protect → evidence → review
  → settlement;
- explicit participant responsibility and money-state communication;
- `USA₮` in product UI and `USAT` only in technical contexts.

The Proof Ledger design language in `DESIGN.md` remains authoritative: warm
ivory and espresso surfaces, Newsreader for agreement moments, Georama for
functional UI, IBM Plex Mono for money and proof data, and a calm non-DeFi
presentation.

---

## 9. Out of Scope

- Multi-token escrow or user-selectable escrow assets.
- Migrating x402 service payments from USDC to USA₮.
- Automatic release, automatic refund, deadline enforcement, or cron-based
  escrow settlement.
- New escrow authority for the Resolution Agent.
- New paid tools or a new agent objective.
- Rewriting or regenerating the frozen AskBots Round-1 record.
- Fee abstraction before a working base mainnet protected-payment E2E.

---

## 10. Source and Implementation Map

### Contract and deployment

- `contracts/src/ProtectedPaymentEscrow.sol`
- `contracts/test/ProtectedPaymentEscrow.t.sol`
- `contracts/test/ProtectedPaymentEscrowInvariant.t.sol`
- `contracts/script/DeployProtectedPaymentEscrow.s.sol`
- `contracts/foundry.toml`
- `contracts/deployments/celo-sepolia.json`

### Web3 and escrow runtime

- `src/lib/web3/chains.ts`
- `src/lib/web3/config.ts`
- `src/lib/web3/tokens.ts`
- `src/lib/contracts/addresses.ts`
- `src/lib/contracts/config.ts`
- `src/lib/contracts/types.ts`
- `src/lib/contracts/attribution.ts`
- `src/hooks/contracts/useCreatePayment.ts`
- `src/hooks/contracts/useTokenApproval.ts`
- `src/hooks/contracts/useEscrowActions.ts`

### Agent, x402, reviewer, and receipts

- `src/lib/x402/config.ts`
- `src/lib/x402/shared.ts`
- `src/lib/x402/paymentStore.supabase.ts`
- `src/lib/x402/settlementProvider.facilitator.ts`
- `src/lib/resolution-agent/api/auth.ts`
- `src/lib/resolution-agent/api/escrow-reader.ts`
- `src/lib/resolution-agent/api/service.ts`
- `src/lib/resolution-agent/adapters/recovery.ts`
- `src/lib/resolution-agent/server/reclaim-transfer.ts`
- `src/lib/reviewer/auth.ts`
- `src/lib/reviewer/execution/executor.ts`
- `src/lib/evidence/chainProvenance.ts`
- `src/lib/evidence/finalReceipt.ts`
- `src/app/api/payments/[paymentId]/evidence/metadata/route.ts`
- `src/app/api/payments/[paymentId]/receipt/route.ts`
- `src/app/api/reviews/route.ts`
- `src/app/api/reviews/[id]/route.ts`
- `src/app/api/reviews/[id]/submit/route.ts`

### Product UX

- `src/app/(marketing)/page.tsx`
- `src/app/(marketing)/how-it-works/page.tsx`
- `src/app/(product)/payments/new/page.tsx`
- `src/app/(product)/payments/[paymentId]/page.tsx`
- `src/components/layout/MarketingHeader.tsx`
- `src/components/layout/UtilityBar.tsx`
- `src/components/payment/OnboardingChecklist.tsx`
- `src/components/payment/MoneyStateStrip.tsx`
- `src/components/payment/PaymentTimeline.tsx`

---

## 11. Approval and Release Rule

P1, P2, and P3 are mandatory for the hackathon release. P4 is mandatory
before AskBots Round 2. P5 is a post-stability improvement and must not delay
the real USA₮ protected-payment E2E.

No implementation, deployment, signature, transaction, production change,
database migration, or AskBots Round 2 run is authorized by this document.
