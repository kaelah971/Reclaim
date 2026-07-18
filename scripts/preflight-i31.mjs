// I3.1 live-test preflight — READ-ONLY. Never prints private keys.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, http, parseAbi, formatEther, formatUnits } from "viem";
import { celoSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const USDC = "0x01C5C0122039549AD1493B8220cABEdD739BC44E";
const ESCROW = "0x0fA826256a58F19Ad24Fc9384d81D313f2266F79";

function parseEnv(path) {
  const out = {};
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v.trim();
  }
  return out;
}

const env = parseEnv(resolve(process.cwd(), ".env.local"));
const payTo = env.X402_PAY_TO_ADDRESS || "";
const rpcUrl = env.NEXT_PUBLIC_CELO_RPC_URL || "https://forno.celo-sepolia.celo-testnet.org";

let relayerKey = env.X402_RELAYER_PRIVATE_KEY || "";
if (relayerKey && !relayerKey.startsWith("0x")) relayerKey = "0x" + relayerKey;

const results = {};

if (!/^0x[0-9a-fA-F]{64}$/.test(relayerKey)) {
  results.relayer_key_valid = false;
} else {
  results.relayer_key_valid = true;
  const account = privateKeyToAccount(relayerKey);
  results.relayer_address = account.address;
  results.relayer_equals_payto = account.address.toLowerCase() === payTo.toLowerCase();
}
relayerKey = null;

results.payto_address = payTo;
results.payto_equals_escrow = payTo.toLowerCase() === ESCROW.toLowerCase();

const client = createPublicClient({ chain: celoSepolia, transport: http(rpcUrl) });

const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

try {
  results.rpc_chain_id = await client.getChainId();
} catch (e) {
  results.rpc_error = String(e && e.message ? e.message.split("\n")[0] : e);
}

if (results.rpc_chain_id === 11142220) {
  const [permit2Code, usdcCode, escrowCode] = await Promise.all([
    client.getCode({ address: PERMIT2 }),
    client.getCode({ address: USDC }),
    client.getCode({ address: ESCROW }),
  ]);
  results.permit2_has_bytecode = !!permit2Code && permit2Code !== "0x";
  results.permit2_bytecode_size = permit2Code ? (permit2Code.length - 2) / 2 : 0;
  results.usdc_has_bytecode = !!usdcCode && usdcCode !== "0x";
  results.escrow_has_bytecode = !!escrowCode && escrowCode !== "0x";

  try {
    const [sym, dec] = await Promise.all([
      client.readContract({ address: USDC, abi: erc20, functionName: "symbol" }),
      client.readContract({ address: USDC, abi: erc20, functionName: "decimals" }),
    ]);
    results.usdc_symbol = sym;
    results.usdc_decimals = Number(dec);
  } catch (e) {
    results.usdc_metadata_error = String(e && e.message ? e.message.split("\n")[0] : e);
  }

  if (results.relayer_address) {
    const celoBal = await client.getBalance({ address: results.relayer_address });
    results.relayer_celo_balance = formatEther(celoBal);
    results.relayer_celo_sufficient = celoBal > 10n ** 16n; // > 0.01 CELO
  }

  if (/^0x[0-9a-fA-F]{40}$/.test(payTo)) {
    const payToUsdc = await client.readContract({
      address: USDC, abi: erc20, functionName: "balanceOf", args: [payTo],
    });
    results.payto_usdc_balance = formatUnits(payToUsdc, 6);
    results.payto_usdc_atomic = payToUsdc.toString();
  }

  const buyer = process.argv[2];
  if (buyer && /^0x[0-9a-fA-F]{40}$/.test(buyer)) {
    const [buyerUsdc, buyerCelo, allowance] = await Promise.all([
      client.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [buyer] }),
      client.getBalance({ address: buyer }),
      client.readContract({
        address: USDC,
        abi: parseAbi(["function allowance(address,address) view returns (uint256)"]),
        functionName: "allowance",
        args: [buyer, PERMIT2],
      }),
    ]);
    results.buyer_address = buyer;
    results.buyer_usdc_balance = formatUnits(buyerUsdc, 6);
    results.buyer_usdc_atomic = buyerUsdc.toString();
    results.buyer_celo_balance = formatEther(buyerCelo);
    results.buyer_permit2_allowance_atomic = allowance.toString();
    results.buyer_permit2_allowance_usdc = formatUnits(allowance, 6);
  }
}

try {
  const res = await fetch("https://api.x402.celo.org/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  results.facilitator_reachable = true;
  results.facilitator_status_on_empty_verify = res.status;
} catch (e) {
  results.facilitator_reachable = false;
  results.facilitator_error = String(e && e.message ? e.message.split("\n")[0] : e);
}

console.log(JSON.stringify(results, null, 2));
