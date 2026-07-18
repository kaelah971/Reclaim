# Reclaim — ProtectedPaymentEscrow

Celo Sepolia escrow contract for Reclaim payments.

## Deployed Contract

| Field | Value |
|---|---|
| Network | Celo Sepolia (chain ID 11142220) |
| Address | `0x0fA826256a58F19Ad24Fc9384d81D313f2266F79` |
| Token | USDC (`0x01C5C0122039549AD1493B8220cABEdD739BC44E`) |
| Deployment TX | `0xa452b3d39fa00356f4c13bb4f46988c2de281640800d0856e6e67b3bc5924312` |
| Record | `deployments/celo-sepolia.json` |
| Broadcast | `broadcast/DeployProtectedPaymentEscrow.s.sol/11142220/run-latest.json` |

## Build & Test

```shell
forge build
forge test -vvv
forge fmt
```

## Deploy

```shell
forge script script/DeployProtectedPaymentEscrow.s.sol \
  --rpc-url celo-sepolia \
  --broadcast \
  --verify
```

Requires `DEPLOYER_PRIVATE_KEY` and `ESCROW_TOKEN_ADDRESS` in `contracts/.env`.

## ABI Export

The ABI is exported to `src/lib/contracts/ProtectedPaymentEscrow.abi.ts` via:

```shell
npm run abi:export
```

### Test

```shell
$ forge test
```

### Format

```shell
$ forge fmt
```

### Gas Snapshots

```shell
$ forge snapshot
```

### Anvil

```shell
$ anvil
```

### Deploy

```shell
$ forge script script/Counter.s.sol:CounterScript --rpc-url <your_rpc_url> --private-key <your_private_key>
```

### Cast

```shell
$ cast <subcommand>
```

### Help

```shell
$ forge --help
$ anvil --help
$ cast --help
```
