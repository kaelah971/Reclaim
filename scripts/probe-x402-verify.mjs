// I3.1 preflight probe — sends a valid-format Permit2 signature from a
// THROWAWAY key (zero funds) through the live route. Cannot move funds.
// Purpose: confirm decode -> structural verify -> facilitator verify pipeline.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const USDC = "0x01C5C0122039549AD1493B8220cABEdD739BC44E";

function parseEnv(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v.trim();
  }
  return out;
}

const env = parseEnv(resolve(process.cwd(), ".env.local"));
const payTo = env.X402_PAY_TO_ADDRESS;
const spender = env.NEXT_PUBLIC_X402_SPENDER_ADDRESS;
if (!payTo || !spender) {
  console.log(JSON.stringify({ error: "payTo or spender env missing" }));
  process.exit(1);
}

const throwaway = privateKeyToAccount(generatePrivateKey());
const nonce = BigInt(Date.now()) * 1000000n + BigInt(Math.floor(Math.random() * 1000000));
const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

const signature = await throwaway.signTypedData({
  domain: { name: "Permit2", chainId: 11142220, verifyingContract: PERMIT2 },
  types: {
    PermitTransferFrom: [
      { name: "permitted", type: "TokenPermissions" },
      { name: "spender", type: "address" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
    TokenPermissions: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
  },
  primaryType: "PermitTransferFrom",
  message: {
    permitted: { token: USDC, amount: 10000n },
    spender,
    nonce,
    deadline,
  },
});

const payload = {
  scheme: "exact",
  network: "eip155:11142220",
  payment: {
    from: throwaway.address,
    to: payTo,
    token: USDC,
    amount: "10000",
    signature,
    nonce: nonce.toString(),
    deadline: deadline.toString(),
    spender,
  },
  requestId: crypto.randomUUID(),
};

const res = await fetch("http://localhost:3000/api/x402/dispute-brief", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "PAYMENT-SIGNATURE": Buffer.from(JSON.stringify(payload)).toString("base64"),
  },
  body: JSON.stringify({
    paymentId: "999999999",
    disputeReason: "Preflight probe - schema check only, throwaway unfunded key.",
    requestedOutcome: "client-refund",
  }),
});

const body = await res.json().catch(() => ({}));
console.log(JSON.stringify({
  probe_buyer: throwaway.address,
  http_status: res.status,
  error: body.error || null,
  has_brief: !!body.brief,
  has_settlement: !!body.settlement,
}, null, 2));
