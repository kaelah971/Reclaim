# Reclaim — Pay with proof.

Protected payments on Celo with clear terms, delivery evidence, fair review, and on-chain settlement.

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

Copy `.env.example` to `.env.local` and configure:

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_CELO_RPC_URL` | Forno Sepolia | Custom Celo RPC URL (optional) |
| `NEXT_PUBLIC_CELO_EXPLORER_URL` | Blockscout Sepolia | Block explorer base URL (optional) |
| `NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS` | USDC on Sepolia | Payment token contract |
| `NEXT_PUBLIC_PAYMENT_TOKEN_SYMBOL` | `USDC` | On-chain token symbol (product copy uses "cUSD") |
| `NEXT_PUBLIC_PAYMENT_TOKEN_DECIMALS` | `6` | Token decimals |
| `NEXT_PUBLIC_PROTECTED_PAYMENT_ESCROW_ADDRESS` | — | Deployed ProtectedPaymentEscrow contract address |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | — | Optional: WalletConnect project ID |

The network itself is fixed in code to **Celo Sepolia** (chain ID `11142220`) in
`src/lib/web3/chains.ts`. There is no chain-ID environment override.

## Network

Reclaim currently uses **Celo Sepolia Testnet** (Chain ID `11142220`) for development.
This replaced Alfajores (chain ID `44787`) following the Celo Sepolia launch.
Testnet tokens have no real-world value.

### Faucet

- [Google Cloud Faucet](https://cloud.google.com/application/web3/faucet/celo/sepolia)
- [Celo Faucet](https://faucet.celo.org/celo-sepolia)

### Adding Celo Sepolia to your wallet

| Field | Value |
|-------|-------|
| Network Name | Celo Sepolia |
| Chain ID | 11142220 |
| Currency Symbol | CELO |
| RPC URL | https://forno.celo-sepolia.celo-testnet.org |
| Explorer | https://celo-sepolia.blockscout.com |

## Payment Token

The escrow token for protected payments is **USDC** (Circle USD Coin) on Celo Sepolia.

| Field | Value |
|-------|-------|
| Address | `0x01C5C0122039549AD1493B8220cABEdD739BC44E` |
| Symbol | USDC |
| Decimals | 6 |
| Source | Circle (faucet.circle.com — Celo Sepolia testnet USDC) |

### Product vs transaction naming

- **Product copy**: Uses "cUSD" / "dollar stablecoin on Celo"
- **Wallet transactions**: Show the on-chain symbol "USDC" to avoid misleading users

### Historical note

The previous token configuration used Mento Dollar (USDm, 18 decimals, `0xdE9e4C3ce781b4bA68120d6261cbad65ce0aB00b`).
This was replaced in I2 with Circle USDC to match the Circle faucet token held by the deployer.

## Deployed Contract

The `ProtectedPaymentEscrow` contract is **already deployed** on Celo Sepolia.
No new deployment is required for normal frontend development.

| Field | Value |
|-------|-------|
| Contract | `0x0fA826256a58F19Ad24Fc9384d81D313f2266F79` |
| Network | Celo Sepolia (chain ID 11142220) |
| Escrow Token | USDC `0x01C5C0122039549AD1493B8220cABEdD739BC44E` (6 decimals) |
| Deployment TX | `0xa452b3d39fa00356f4c13bb4f46988c2de281640800d0856e6e67b3bc5924312` |
| Source Verified | Blockscout |
| Explorer | https://celo-sepolia.blockscout.com/address/0x0fA826256a58F19Ad24Fc9384d81D313f2266F79 |

### contracts/.env

`contracts/.env` is **not required** for normal frontend use. It is only needed for:
- Future deployment-owner operations
- Contract source verification
- Pause / admin actions
- Deployment scripting

No new deployment should be made without an explicit migration decision.

## x402 Paid Service: Dispute Preparation Brief

Reclaim implements the **x402 v2** payment protocol for one paid service: automated
dispute brief preparation. The brief is generated deterministically from on-chain
payment data and user-submitted dispute details — no AI/LLM is called.

### Protocol Details

| Field | Value |
|-------|-------|
| x402 Protocol Version | v2 |
| Facilitator URL | `https://x402.celo.org` |
| CAIP-2 Network Identifier | `eip155:11142220` (Celo Sepolia) |
| Payment Scheme | `exact` (Permit2-style EVM signature) |
| Payment Token | USDC (`0x01C5C0122039549AD1493B8220cABEdD739BC44E`, 6 decimals) |
| Service Price | `$0.01` USDC (configurable via `X402_DISPUTE_BRIEF_PRICE`) |

### API Endpoint

```
POST /api/x402/dispute-brief
```

**Request flow:**

1. Client sends a POST without a `PAYMENT-SIGNATURE` header → server returns
   HTTP 402 with a `PAYMENT-REQUIRED` header containing payment requirements
   (network, price, payTo address, token contract).
2. Client pays the USDC fee and retries the request with a `PAYMENT-SIGNATURE`
   header containing the base64-encoded payment payload.
3. Server verifies the payment payload, reads on-chain escrow data, generates a
   structured dispute brief, and returns it with a `PAYMENT-RESPONSE` header.

**Request body fields:** See `src/lib/x402/validation.ts` for the full Zod schema.

### Configuring the payTo Address

The `payTo` address in the x402 payment requirement is the **Reclaim service-revenue
wallet** — it is NOT the escrow contract. Set it via environment variables:

| Variable | Scope | Purpose |
|----------|-------|---------|
| `X402_PAY_TO_ADDRESS` | Server-only | Address that receives x402 service fees |
| `NEXT_PUBLIC_X402_PAY_TO_ADDRESS` | Client-safe | Fallback if server variable is unset; used by pay button UI |

### x402 Fees vs Escrow Funds

The x402 fee is **completely separate** from the funds held in the
`ProtectedPaymentEscrow` contract:

- **Escrow funds:** Held on-chain in the escrow contract; released to the worker
  or refunded to the client according to the agreement terms and dispute resolution.
- **x402 service fee:** A micro-payment sent to the Reclaim service wallet
  for the dispute brief preparation service. This fee is independent of the
  escrow lifecycle.

### Security Considerations

- `contracts/.env` is **not needed** for x402 operation — the facilitator and
  settlement logic are self-contained in the Next.js API route.
- The `PAYMENT-SIGNATURE` header must contain a valid Permit2-style signature
  authorizing a USDC transfer from the buyer to the service wallet.
- All requests include a `correlationId` for tracing.
- Server-side config (`config.ts`) is never exposed to the browser — use
  `config.public.ts` for client-safe values.
- The dispute brief generator is purely deterministic — no AI/LLM is called,
  so no prompt injection or hallucination risk exists.

### Manual API Test

Run the PowerShell integration test script against a local dev server:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/test-x402-dispute-brief.ps1
```

This sends an unpaid request to the API and validates the HTTP 402 response,
`PAYMENT-REQUIRED` header format, and payment requirement fields.

## Wallet Support

- **Injected browser wallets** (MetaMask, etc.) — fully supported
- **WalletConnect** — optional and currently unavailable. The connector is only
  created when `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is set, and connecting
  additionally requires the optional peer dependency
  `@walletconnect/ethereum-provider` (not currently installed):
  `npm install @walletconnect/ethereum-provider`. When the project ID is absent,
  WalletConnect is not initialized and is not shown in the wallet dialog;
  injected wallets keep working.

A single wallet dialog is owned by `WalletGateProvider`
(`src/providers/WalletGateProvider.tsx`). Pages and buttons trigger it through
`useRequireWallet()` — no page owns its own wallet dialog.

### How to test

1. Install MetaMask or another Celo-compatible browser wallet.
2. Add Celo Sepolia network using the values in the table above.
3. Click "Connect wallet" in the Reclaim UI.
4. Approve the connection in your wallet.

### Testing wrong-network behavior

1. Connect your wallet while on a non-Celo network (e.g. Ethereum mainnet).
2. Click any wallet-required action (create payment, evidence, dispute,
   reviewer submission, refund scan).
3. The switch-network dialog should appear immediately, showing your current
   chain ID and the required network (Celo Sepolia, 11142220).
4. Rejecting the switch shows "The network switch was cancelled." and your
   entered form data is preserved.
5. Approving the switch continues to the existing frontend integration notice.
   No transaction is ever sent.

### Testing no-provider behavior

1. Open Reclaim in a browser with no wallet extension installed.
2. Click "Connect wallet". The dialog should say
   "No compatible browser wallet was found." and explain that a Celo-compatible
   EVM wallet is required, with Retry and Close.

### Manual verification checklist (no test framework installed)

- Address shortening: connected header button shows `0x1234…abcd` format.
- Supported-network helper: green dot when on Celo Sepolia, amber otherwise.
- Explorer links: account menu / receipt references point at Blockscout Sepolia.
- Connection rejected: cancel in wallet → "The connection request was cancelled." + Retry.
- Wrong-network gate: see "Testing wrong-network behavior" above.
- Ready gate: on Celo Sepolia, wallet-required actions open the existing
  frontend-only integration notices; no transaction or approval is requested.
- WalletConnect hidden: with no project ID configured, the dialog lists only
  "Browser wallet".

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server (port 3000) |
| `npm run build` | Production build (normal TypeScript validation, no extra memory flags required) |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript type-check |
| `npm run test` | Run unit tests (vitest) |
| `npm run test:watch` | Run tests in watch mode |

## x402 Architecture

The x402 payment protocol is implemented as a self-contained module at
`src/lib/x402/` and a Next.js API route at `src/app/api/x402/dispute-brief/`.

### Module Structure

```
src/lib/x402/
├── types.ts          # Core x402 v2 protocol types (PaymentRequirements, PaymentPayload, etc.)
├── config.ts         # Server-side configuration (secrets, derived values)
├── config.public.ts  # Browser-safe configuration (NEXT_PUBLIC_ variables only)
├── shared.ts         # Shared helpers: header encoding/decoding, payment verification
├── validation.ts     # Zod schema for dispute brief request body
├── disputeBrief.ts   # Deterministic brief generator (no AI)
└── __tests__/
    ├── disputeBrief.test.ts  # Unit tests for brief generation & validation
    └── x402.test.ts          # Unit tests for shared helpers & protocol types
```

### Server-Side Config (No Browser Exposure)

`config.ts` is marked **SERVER-ONLY** — it imports escrow and token config from
`@/lib/web3/tokens` and reads `X402_PAY_TO_ADDRESS` from the server environment.
It is never imported by client components. Client-safe values are exposed
separately through `config.public.ts`.

### HTTP 402 Flow

```
Client                          Server (Next.js API Route)
  │                                   │
  │  POST /api/x402/dispute-brief     │
  │  (no PAYMENT-SIGNATURE header)    │
  │ ─────────────────────────────────>│
  │                                   │ builds PaymentRequirements
  │  402 + PAYMENT-REQUIRED header    │
  │ <─────────────────────────────────│ base64-encoded JSON:
  │                                   │   { accepts: [{ scheme, price,
  │                                   │     network, payTo, asset }],
  │                                   │     description, mimeType }
  │                                   │
  │  Client pays USDC fee             │
  │  (Permit2 signature)              │
  │                                   │
  │  POST /api/x402/dispute-brief     │
  │  + PAYMENT-SIGNATURE header       │
  │ ─────────────────────────────────>│
  │                                   │ decodes & verifies payload
  │                                   │ validates request body
  │                                   │ reads on-chain payment data
  │                                   │ generates dispute brief
  │  200 + PAYMENT-RESPONSE header    │
  │ <─────────────────────────────────│ settlement confirmation
  │                                   │
```

### Header Formats

**PAYMENT-REQUIRED** (server → client, HTTP 402):
Base64-encoded JSON of a `PaymentRequirements` object:
```json
{
  "accepts": [
    {
      "scheme": "exact",
      "price": "$0.01",
      "network": "eip155:11142220",
      "payTo": "0x...",
      "asset": "0x01C5C0122039549AD1493B8220cABEdD739BC44E",
      "assetDecimals": 6
    }
  ],
  "description": "Reclaim dispute preparation brief",
  "mimeType": "application/json"
}
```

**PAYMENT-SIGNATURE** (client → server, retry request):
Base64-encoded JSON of a `PaymentPayload` object containing the EIP-712
Permit2-style signature authorizing a USDC transfer.

**PAYMENT-RESPONSE** (server → client, HTTP 200):
Base64-encoded JSON of settlement confirmation including success status,
correlation ID, and an optional transaction hash.

### Settlement Lifecycle

1. **Verification:** Server validates the payment payload structure (scheme,
   network, addresses, token, amount, signature format). Full Permit2 signature
   verification with EIP-712 typed data recovery is planned for a future iteration.
2. **On-chain read:** Server reads the escrow payment's current state and terms
   from the `ProtectedPaymentEscrow` contract via viem's public client.
3. **Brief generation:** The deterministic `generateDisputeBrief()` function
   combines on-chain data with user-submitted dispute details to produce a
   structured, human-readable brief.
4. **Settlement recording:** The server records the payment as verified. Full
   on-chain settlement (executing the Permit2 transfer) will be added when the
   buyer-side signing flow is implemented.

### Distinction: Escrow vs x402 Service Revenue

| Aspect | Escrow Contract | x402 Service |
|--------|----------------|--------------|
| **Funds source** | Client deposits for the protected payment | Client pays a micro-fee for the brief |
| **Funds destination** | Worker (on release) or client (on refund) | Reclaim service-revenue wallet |
| **Contract** | `ProtectedPaymentEscrow` | No separate contract — settled via Permit2 |
| **Lifecycle** | Created → Funded → ... → Released/Cancelled | Pay → Verify → Brief delivered |
| **Disputes** | Handled by human reviewers | The brief aids reviewers but does not decide |

## Tech Stack

- **Framework:** Next.js 16 (App Router)
- **Language:** TypeScript 5 (strict mode)
- **Styling:** Tailwind CSS v4
- **Fonts:** Newsreader (display), Georama (UI), IBM Plex Mono (data)
- **Wallet:** wagmi + viem + @tanstack/react-query
- **Network:** Celo Sepolia Testnet (Chain ID: 11142220)

## What is intentionally unimplemented

- Supabase / authentication / database profiles
- Reviewer voting / settlement execution
- Receipt / attribution-tag transaction generation
- CSV transaction analysis / recovery package generation
- WalletConnect connections (optional; requires project ID + optional peer dependency)
- x402 AI/LLM-powered briefs (template-based deterministic brief is implemented instead)

## What is implemented and deployed

- ProtectedPaymentEscrow contract (deployed, verified, canonical)
- Payment lifecycle: create, fund, accept, evidence, release, dispute, cancel
- Frontend contract config, typed read/write hooks, ABI export
- Payment creation, dashboard, payment room, evidence submission, dispute UI
- Token config (USDC, 6 decimals, Celo Sepolia)
- Wallet connection, network detection, error handling
- **x402 v2 paid service:** Dispute preparation brief API endpoint
  (`POST /api/x402/dispute-brief`) with HTTP 402 payment-gated flow,
  deterministic brief generation, and Permit2-style payment verification
