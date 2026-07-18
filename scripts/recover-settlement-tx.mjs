import { createPublicClient, http, parseAbi, decodeEventLog } from "viem";
import { celoSepolia } from "viem/chains";

const USDC = "0x01C5C0122039549AD1493B8220cABEdD739BC44E";
const BUYER = "0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486";
const PAYTO = "0x85522bdE267d05bf8CE8813F97c75417b7894A33";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const RELAYER = "0x0822d288110f0b2a4A71a8138DD767DF95009a2d";

const client = createPublicClient({
  chain: celoSepolia,
  transport: http("https://forno.celo-sepolia.celo-testnet.org"),
});

const currentBlock = await client.getBlockNumber();
const fromBlock = currentBlock - 5000n;

const transferAbi = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

const logs = await client.getLogs({
  address: USDC,
  event: transferAbi[0],
  args: { from: BUYER, to: PAYTO },
  fromBlock,
  toBlock: currentBlock,
});

for (const log of logs) {
  const decoded = decodeEventLog({
    abi: transferAbi,
    data: log.data,
    topics: log.topics,
    eventName: "Transfer",
  });
  const amount = decoded.args.value;
  if (amount !== 10000n) continue;

  const receipt = await client.getTransactionReceipt({ hash: log.transactionHash });
  const tx = await client.getTransaction({ hash: log.transactionHash });

  // Extract nonce from calldata
  const callData = tx.input;
  const data = callData.slice(10);
  const nonceHex = "0x" + data.slice(64 * 2, 96 * 2);
  const nonce = BigInt(nonceHex);

  console.log(JSON.stringify({
    txHash: log.transactionHash,
    blockNumber: Number(log.blockNumber),
    submitter: tx.from,
    contractCalled: tx.to,
    receiptStatus: receipt.status,
    amount: "10000",
    nonce: nonce.toString(),
    gasUsed: receipt.gasUsed.toString(),
  }, null, 2));
}
