import { http, createConfig, cookieStorage, createStorage } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import type { CreateConnectorFn } from "wagmi";
import { celoChain } from "./chains";

const walletConnectProjectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

function buildConnectors(): CreateConnectorFn[] {
  const connectors: CreateConnectorFn[] = [injected()];
  if (walletConnectProjectId) {
    connectors.push(
      walletConnect({
        projectId: walletConnectProjectId,
        showQrModal: true,
      })
    );
  }
  return connectors;
}

export const wagmiConfig = createConfig({
  chains: [celoChain],
  connectors: buildConnectors(),
  transports: {
    [celoChain.id]: http(process.env.NEXT_PUBLIC_CELO_RPC_URL || undefined),
  },
  ssr: true,
  storage: createStorage({
    storage: cookieStorage,
  }),
});
