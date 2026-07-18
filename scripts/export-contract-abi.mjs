/**
 * Export the ProtectedPaymentEscrow ABI from the Foundry build artifact
 * into a typed TypeScript module consumed by the frontend.
 *
 * Regenerate whenever the contract changes:
 *   1. cd contracts && forge build
 *   2. npm run abi:export
 *
 * Do NOT hand-edit src/lib/contracts/ProtectedPaymentEscrow.abi.ts —
 * it must always mirror the compiled (and deployed) contract exactly.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const ARTIFACT_PATH = resolve(
  repoRoot,
  "contracts/out/ProtectedPaymentEscrow.sol/ProtectedPaymentEscrow.json",
);
const OUTPUT_PATH = resolve(
  repoRoot,
  "src/lib/contracts/ProtectedPaymentEscrow.abi.ts",
);

function main() {
  let artifactRaw;
  try {
    artifactRaw = readFileSync(ARTIFACT_PATH, "utf8");
  } catch {
    console.error(
      `Artifact not found at ${ARTIFACT_PATH}.\n` +
        "Run `forge build` inside contracts/ first.",
    );
    process.exit(1);
  }

  const artifact = JSON.parse(artifactRaw);
  if (!Array.isArray(artifact.abi) || artifact.abi.length === 0) {
    console.error("Artifact has no ABI entries — aborting.");
    process.exit(1);
  }

  const abiJson = JSON.stringify(artifact.abi, null, 2);

  const banner = `/**
 * ProtectedPaymentEscrow ABI — generated from the Foundry build artifact.
 *
 * Source artifact: contracts/out/ProtectedPaymentEscrow.sol/ProtectedPaymentEscrow.json
 * Regenerate with: npm run abi:export   (after \`forge build\` in contracts/)
 *
 * DO NOT EDIT BY HAND.
 */
export const protectedPaymentEscrowABI = ${abiJson} as const;
`;

  writeFileSync(OUTPUT_PATH, banner, "utf8");
  console.log(
    `Wrote ${artifact.abi.length} ABI entries to src/lib/contracts/ProtectedPaymentEscrow.abi.ts`,
  );
}

main();
