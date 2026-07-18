import { CELO_NETWORK_NAME } from "./chains";

export type WalletErrorCode =
  | "connection-rejected"
  | "no-provider"
  | "wrong-network"
  | "switch-rejected"
  | "request-pending"
  | "unknown";

export const walletErrorMessages: Record<
  WalletErrorCode,
  { title: string; description: string }
> = {
  "connection-rejected": {
    title: "The connection request was cancelled.",
    description: "You can try connecting again when you are ready.",
  },
  "no-provider": {
    title: "No compatible browser wallet was found.",
    description:
      "A Celo-compatible EVM wallet such as MetaMask is required. Install one, then reload Reclaim.",
  },
  "wrong-network": {
    title: "Switch to Celo to continue.",
    description: `This action requires the ${CELO_NETWORK_NAME} network.`,
  },
  "switch-rejected": {
    title: "The network switch was cancelled.",
    description: `You can retry the switch to ${CELO_NETWORK_NAME} when you are ready.`,
  },
  "request-pending": {
    title: "A wallet request is already waiting for approval.",
    description: "Check your wallet for a pending request, then try again.",
  },
  unknown: {
    title: "The wallet could not be connected. Try again.",
    description:
      "An unexpected error occurred. Check that your wallet is unlocked and supports the Celo network.",
  },
};

interface ErrorLike {
  name?: string;
  code?: number;
  message?: string;
  cause?: unknown;
}

function collectErrorChain(error: unknown): ErrorLike[] {
  const chain: ErrorLike[] = [];
  let current: unknown = error;
  let depth = 0;
  while (current && typeof current === "object" && depth < 6) {
    chain.push(current as ErrorLike);
    current = (current as ErrorLike).cause;
    depth += 1;
  }
  return chain;
}

export function translateConnectError(error: unknown): WalletErrorCode {
  for (const err of collectErrorChain(error)) {
    if (err.name === "UserRejectedRequestError" || err.code === 4001) {
      return "connection-rejected";
    }
    if (
      err.name === "ResourceUnavailableRpcError" ||
      err.code === -32002
    ) {
      return "request-pending";
    }
    if (err.name === "ProviderNotFoundError") {
      return "no-provider";
    }
    const message = err.message?.toLowerCase() ?? "";
    if (message.includes("rejected") || message.includes("cancelled") || message.includes("denied")) {
      return "connection-rejected";
    }
    if (message.includes("already pending") || message.includes("already processing")) {
      return "request-pending";
    }
    if (message.includes("provider not found") || message.includes("no provider")) {
      return "no-provider";
    }
  }
  return "unknown";
}

export function translateSwitchError(error: unknown): WalletErrorCode {
  for (const err of collectErrorChain(error)) {
    if (err.name === "UserRejectedRequestError" || err.code === 4001) {
      return "switch-rejected";
    }
    if (err.name === "ResourceUnavailableRpcError" || err.code === -32002) {
      return "request-pending";
    }
    const message = err.message?.toLowerCase() ?? "";
    if (message.includes("rejected") || message.includes("cancelled") || message.includes("denied")) {
      return "switch-rejected";
    }
    if (message.includes("already pending") || message.includes("already processing")) {
      return "request-pending";
    }
  }
  return "unknown";
}
