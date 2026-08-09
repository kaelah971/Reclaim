import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev-only webpack compatibility: wagmi's @wagmi/core marks its dynamic
  // imports of OPTIONAL packages (accounts, @walletconnect/ethereum-provider,
  // porto) with `/* turbopackOptional: true */`, which Turbopack understands
  // but webpack (next dev --webpack) does not, failing the whole build with
  // "Module not found: Can't resolve '...'". The imports are genuinely
  // optional at runtime (wagmi catches their absence), so aliasing them to
  // empty modules restores webpack dev builds without changing behavior.
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      accounts: false,
      "@walletconnect/ethereum-provider": false,
      porto: false,
      "porto/internal": false,
    };
    return config;
  },
};

export default nextConfig;
