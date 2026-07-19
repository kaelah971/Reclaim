import { keccak256, stringToHex } from "viem";

export const SERVICE_IDENTIFIER = "reclaim-dispute-brief-v1";

export interface RequestHashParams {
  paymentId: string;
  disputeReason: string;
  requestedOutcome: string;
  buyerAddress: string;
  network: string;
  serviceIdentifier?: string;
  price: string;
  payToAddress: string;
}

export function computeRequestHash(params: RequestHashParams): string {
  const service = params.serviceIdentifier || SERVICE_IDENTIFIER;
  const canonical = [
    service,
    params.paymentId,
    params.disputeReason,
    params.requestedOutcome,
    params.buyerAddress.toLowerCase(),
    params.network,
    params.price,
    params.payToAddress.toLowerCase(),
  ].join(":");
  return keccak256(stringToHex(canonical));
}
