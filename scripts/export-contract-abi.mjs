/**
 * Export ProtectedPaymentEscrow ABIs from the Foundry build artifacts
 * into typed TypeScript modules consumed by the frontend.
 *
 * Regenerate whenever a contract changes:
 *   1. cd contracts && forge build
 *   2. npm run abi:export
 *
 * Do NOT hand-edit src/lib/contracts/ProtectedPaymentEscrow.abi.ts or
 * src/lib/contracts/ProtectedPaymentEscrowV2.abi.ts —
 * they must always mirror the compiled (and deployed) contracts exactly.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const EXPORTS = [
  {
    artifact: "contracts/out/ProtectedPaymentEscrow.sol/ProtectedPaymentEscrow.json",
    output: "src/lib/contracts/ProtectedPaymentEscrow.abi.ts",
    exportName: "protectedPaymentEscrowABI",
    title: "ProtectedPaymentEscrow ABI",
  },
  {
    artifact:
      "contracts/out/ProtectedPaymentEscrowV2.sol/ProtectedPaymentEscrowV2.json",
    output: "src/lib/contracts/ProtectedPaymentEscrowV2.abi.ts",
    exportName: "protectedPaymentEscrowV2ABI",
    title: "ProtectedPaymentEscrowV2 ABI",
  },
];

function exportOne({ artifact, output, exportName, title }) {
  const artifactPath = resolve(repoRoot, artifact);
  const outputPath = resolve(repoRoot, output);
  let artifactRaw;
  try {
    artifactRaw = readFileSync(artifactPath, "utf8");
  } catch {
    console.error(
      `Artifact not found at ${artifactPath}.\n` +
        "Run `forge build` inside contracts/ first.",
    );
    process.exit(1);
  }

  const parsed = JSON.parse(artifactRaw);
  if (!Array.isArray(parsed.abi) || parsed.abi.length === 0) {
    console.error(`Artifact ${artifact} has no ABI entries — aborting.`);
    process.exit(1);
  }

  const abiJson = JSON.stringify(parsed.abi, null, 2);

  const banner = `/**
 * ${title} — generated from the Foundry build artifact.
 *
 * Source artifact: ${artifact}
 * Regenerate with: npm run abi:export   (after \`forge build\` in contracts/)
 *
 * DO NOT EDIT BY HAND.
 */
export const ${exportName} = ${abiJson} as const;
`;

  writeFileSync(outputPath, banner, "utf8");
  console.log(
    `Wrote ${parsed.abi.length} ABI entries to ${output}`,
  );
}

for (const spec of EXPORTS) exportOne(spec);
