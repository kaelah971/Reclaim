# Track 2 Settlement Audit Record

Generated: 2026-07-29

## Registration

| Field | Value |
|-------|-------|
| Project | Reclaim |
| Registration ID | `629aafee-b989-4ec6-929c-a4acdf2caebd` |
| Track | `most-x402-payments` (Track 2) |
| GitHub | https://github.com/kaelah971/Reclaim |
| Telegram | @iamkaelah |
| Registered payTo | `0x85522bdE267d05bf8CE8813F97c75417b7894A33` |
| Attribution Tag | `celo_b7de8bf7e64e` |
| Status | `draft` (not yet published) |
| Celo Network | To be set to `celo-mainnet` before submission |

## Official Facilitator

| Field | Value |
|-------|-------|
| API | `https://api.x402.celo.org` |
| x402 Version | 2 |
| Scheme | `exact` |
| Network | `eip155:42220` (Celo Mainnet) |
| USDC | `0xcebA9300f2b948710d2653dD7B07f33A8B32118C` |
| Facilitator Signer | `0x0d74D5Cefd2e7F24E623330ebE3d8D4cB45fFB48` |

## Settlement #1 (Canonical)

| Field | Value |
|-------|-------|
| Transaction Hash | `0x2e8a3459ac4566397def48606670cd2a4e48d8f3dfbeda166f1bf1b82951ab5d` |
| Block | `73407603` |
| Timestamp | 2026-07-29T06:59:21Z |
| Amount | 0.01 USDC (10000 atomic) |
| Payer | `0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486` |
| PayTo | `0x85522bdE267d05bf8CE8813F97c75417b7894A33` |
| Token | `0xcebA9300f2b948710d2653dD7B07f33A8B32118C` |
| Network | Celo Mainnet (42220) |
| Facilitator Settlement | Yes |
| Track 2 Eligible | Yes |

## Settlement #2 (Accidental Duplicate)

| Field | Value |
|-------|-------|
| Transaction Hash | `0xecf044fd2af5cc518d7841446b886b246c5ad8d156e21e10e68ed5e755f6f706` |
| Block | `73409370` |
| Timestamp | 2026-07-29T07:28:48Z |
| Amount | 0.01 USDC (10000 atomic) |
| Payer | `0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486` |
| PayTo | `0x85522bdE267d05bf8CE8813F97c75417b7894A33` |
| Token | `0xcebA9300f2b948710d2653dD7B07f33A8B32118C` |
| Network | Celo Mainnet (42220) |
| Facilitator Settlement | Yes |
| Track 2 Eligible | Yes (duplicate of same logical request) |

## Balances

| Wallet | USDC |
|--------|------|
| Payer (`0x76D7a718...`) | 3.342769 |
| PayTo (`0x85522bd...`) | 0.02 |

## Leaderboard Status

- URL: https://dune.com/celo/agentic-payments-defai-hackathon
- Access: Restricted (Dune query requires authentication)
- Indexing may be delayed — check manually

## Notes

- Both transactions were settled through the official Celo x402 facilitator
- The facilitator signer (`0x0d74D5...`) broadcast both settlement transactions
- Both used EIP-3009 TransferWithAuthorization mechanism
- Settlement #2 was an accidental duplicate caused by a missing server-side duplicate check (now fixed in T2.2G)
- The server-side duplicate-settlement gate was moved before `/verify` to prevent future duplicates
- No further facilitator settlements should occur for the same canonical request
