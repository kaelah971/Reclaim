import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    // Provide x402 server configuration for tests so config.ts module-level
    // constants evaluate correctly (the payTo address, USDC address, and
    // dispute brief price must be non-empty for verification tests).
    env: {
      X402_PAY_TO_ADDRESS: "0xaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaA",
      X402_USDC_ADDRESS: "0x1111111111111111111111111111111111111111",
      NEXT_PUBLIC_CELO_RPC_URL: "https://forno.celo-sepolia.celo-testnet.org",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
