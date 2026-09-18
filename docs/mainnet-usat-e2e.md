# First Celo Mainnet USA₮ Protected Payment — E2E Evidence (RA2.3D)

First real end-to-end protected payment on **Celo Mainnet (chain ID 42220)** using the
deployed `ProtectedPaymentEscrow` and USA₮. Full lifecycle executed on-chain:
Created → Funded → Accepted → DeliverySubmitted → ReleaseRequested → Released.

## Deployment (P3)

- Escrow: `0xE42cF4620DE454bE0De5004255d25683e4F882c4`
- Deployment tx: `0x9f2c79705fc02b60835e37f84caad98b02e17830ec8d3528dc96950387a01ae3`
  (block 77810953 — contract-creation transaction is **unattributed**: no ERC-8021
  calldata suffix on create)
- Chain: Celo Mainnet / 42220 (`https://forno.celo.org`)
- USA₮ token: `0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771` (symbol USAT, 6 decimals)
- Owner: `0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486`
- Canonical record: `contracts/deployments/celo-mainnet.json` (v1, `resolveDispute: true`)
- Explorer: https://celoscan.io/address/0xE42cF4620DE454bE0De5004255d25683e4F882c4

## Payment #1

- Payment ID: `1`
- Amount: **0.05 USA₮** = `50,000` base units
- Client: `0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486`
- Worker: `0x85522bdE267d05bf8CE8813F97c75417b7894A33`
- Terms label (bytes32, E2E-safe 29-byte form): `Reclaim mainnet protected E2E`
  (`0x5265636c61696d206d61696e6e65742070726f74656374656420453245000000`)
- Delivery deadline: `1790324444` (2026-09-25T08:20:44Z), auto-release disabled,
  dispute window 3 days
- Evidence hash: `0x685444d11f6b1518db6d76e7aaab56ebf85b1d0ee3cfdd911f6d4cf6f57644d3`
- Canonical evidence text: `Reclaim mainnet protected payment E2E delivery proof`
  (52 UTF-8 bytes; `keccak256` of the text equals the evidence hash above)
- Final state: **Released** (`releasedAt` 1789723699; `releaseRequestedAt` 1789723277 preserved)

## Transactions (all 7 verified on-chain)

| # | Call | Tx hash |
|---|------|---------|
| 1 | `createPayment` | `0xa9f0910eb129ae07b2662b5badbd7506337f56b0ec3d4fa81e15b00f03373f90` |
| 2 | USA₮ `approve` (escrow, 50000) | `0xe286af1d88027fcfc7aaa74e5cea6701fb7d550daabd7f8f7ecb3739567144e9` |
| 3 | `fundPayment(1)` | `0x00c8221dee261634cacf16641e91503b3939a10e78671619252fc5985fa92d34` |
| 4 | `acceptPayment(1)` | `0xe2beb0ae1f8dbeaab452a0020c79f7a8d69c130da14b7ec8967c5186f111e3cd` |
| 5 | `submitEvidenceHash(1, 0x6854…44d3)` | `0x559d3e2ffb89c032a54b150fef7319c136c45ff7c5952e36ba18dc3fd7c602a0` |
| 6 | `requestRelease(1)` | `0x218e2d1c3da4da5cb410cfe068da07c00ab8b595263335a96c8646bc25550466` |
| 7 | `approveRelease(1)` | `0x225bfccf2d0f248582ae62d966d0de4681340698446889135facb0968b44656f` |

Explorer links: `https://celoscan.io/tx/<hash>` for each hash above.

## Verified lifecycle

Created → Funded → Accepted → DeliverySubmitted → ReleaseRequested → Released,
each transition confirmed by success receipt, exact state read-back, and its
corresponding event (`PaymentCreated`, `PaymentFunded`, `PaymentAccepted`,
`DeliveryEvidenceSubmitted`, `ReleaseRequested`, `PaymentReleased`) — one event
per step, all bound to Payment #1.

## Final settlement balances

- Escrow USA₮: `50,000` → `0`
- Worker USA₮: `0` → `50,000`
- Client USA₮ after settlement: `50,047` (started `100,047`; exactly `50,000` escrowed and released)
- Allowance (client → escrow): `0` → `50,000` (approve) → `0` (consumed by funding)
- `paymentCount` remained `1` throughout — no second payment was created.

## Attribution

Attribution tag: `celo_b7de8bf7e64e` (see `NEXT_PUBLIC_CELO_ATTRIBUTION_TAG` and
`src/lib/contracts/attribution.ts`, which appends the SDK-encoded ERC-8021 data
suffix via the existing attribution path).

All **seven** Reclaim-controlled E2E transactions above carry the tag: each
on-chain input ends with the suffix
`0x63656c6f5f623764653862663765363465110080218021802180218021802180218021`,
which decodes (`fromDataSuffix`) to schema 0, codes `["celo_b7de8bf7e64e"]`.
Verified against actual on-chain transaction inputs, not just locally built calldata.

The deployment transaction itself is explicitly recorded as **unattributed**
(no calldata suffix on contract creation).

## Operational note

Forno RPC served stale heads on several immediate post-receipt reads during this
run. No transaction was ever rebroadcast for that reason: every step was confirmed
via success receipts, emitted events, and cross-RPC agreement (Forno plus two
independent mainnet RPCs) before proceeding.
