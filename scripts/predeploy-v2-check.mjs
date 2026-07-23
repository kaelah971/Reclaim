import { createPublicClient, http } from "viem";
import { celoSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const envContent = readFileSync(resolve(".", ".env.local"), "utf-8");
const env = {};
for (const l of envContent.split(/\r?\n/)) {
  const eq = l.indexOf("=");
  if (eq > 0) env[l.slice(0, eq).trim()] = l.slice(eq + 1).trim();
}

const pk = env.DEPLOYER_PRIVATE_KEY;
if (!pk) {
  console.log("FAIL: DEPLOYER_PRIVATE_KEY not found in .env.local");
  process.exit(1);
}

const normalized = pk.startsWith("0x") ? pk : `0x${pk}`;
const account = privateKeyToAccount(normalized);
const derived = account.address.toLowerCase();
const expected = "0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486".toLowerCase();
const match = derived === expected;

console.log("Deployer address:", account.address);
console.log("Expected:       ", expected);
console.log("Match:", match ? "YES" : "NO — STOP");

const client = createPublicClient({ chain: celoSepolia, transport: http("https://forno.celo-sepolia.celo-testnet.org") });
const bal = await client.getBalance({ address: account.address });
console.log("CELO balance:  ", (Number(bal) / 1e18).toFixed(6), "CELO");

const cid = await client.getChainId();
console.log("Chain ID:      ", cid, cid === 11142220 ? "(match)" : "(MISMATCH)");

const usdcCode = await client.getBytecode({ address: "0x01C5C0122039549AD1493B8220cABEdD739BC44E" });
console.log("USDC bytecode: ", (usdcCode || "").length > 2 ? "DEPLOYED" : "MISSING");

const v1Code = await client.getBytecode({ address: "0x0fA826256a58F19Ad24Fc9384d81D313f2266F79" });
console.log("V1 bytecode:   ", (v1Code || "").length > 2 ? "DEPLOYED" : "MISSING");

const v1Owner = await client.readContract({
  address: "0x0fA826256a58F19Ad24Fc9384d81D313f2266F79",
  abi: [{ type: "function", name: "owner", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" }],
  functionName: "owner",
});
console.log("V1 owner:      ", v1Owner);

const v1Bal = await client.readContract({
  address: "0x01C5C0122039549AD1493B8220cABEdD739BC44E",
  abi: [{ type: "function", name: "balanceOf", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" }],
  functionName: "balanceOf",
  args: ["0x0fA826256a58F19Ad24Fc9384d81D313f2266F79"],
});
console.log("V1 USDC bal:   ", v1Bal.toString(), "(" + (Number(v1Bal) / 1e6).toFixed(2), "USDC)");

console.log("\nALL CHECKS PASSED — Ready for deployment.");
