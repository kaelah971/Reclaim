import { CELO_CHAIN_ID } from "./chains";

const FALLBACK_TOKEN_ADDRESS = "0x01C5C0122039549AD1493B8220cABEdD739BC44E";

export const PAYMENT_TOKEN_ADDRESS =
  process.env.NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS || FALLBACK_TOKEN_ADDRESS;

export const PAYMENT_TOKEN_SYMBOL =
  process.env.NEXT_PUBLIC_PAYMENT_TOKEN_SYMBOL || "USDC";

export const PAYMENT_TOKEN_NAME = "USD Coin";

const parsedDecimals = Number(process.env.NEXT_PUBLIC_PAYMENT_TOKEN_DECIMALS);
export const PAYMENT_TOKEN_DECIMALS = Number.isInteger(parsedDecimals)
  ? parsedDecimals
  : 6;

export interface PaymentTokenConfig {
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  chainId: number;
}

export function getPaymentTokenConfig(): PaymentTokenConfig {
  if (!/^0x[0-9a-fA-F]{40}$/.test(PAYMENT_TOKEN_ADDRESS)) {
    throw new Error(`Invalid payment token address: ${PAYMENT_TOKEN_ADDRESS}`);
  }
  return {
    address: PAYMENT_TOKEN_ADDRESS as `0x${string}`,
    symbol: PAYMENT_TOKEN_SYMBOL,
    name: PAYMENT_TOKEN_NAME,
    decimals: PAYMENT_TOKEN_DECIMALS,
    chainId: CELO_CHAIN_ID,
  };
}
