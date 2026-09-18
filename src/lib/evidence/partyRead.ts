// ---------------------------------------------------------------------------
// P4.3D party read helper (client, for P4.4 reuse).
//
// Minimal flow: requestChallenge → personal_sign via wagmi → fetch plaintext.
// This module performs NO signing itself — the caller passes a wagmi-style
// signMessage function so the helper stays framework-agnostic. The Room stays
// hash-only; P4.4 wires this helper into release UX.
//
//   const evidence = await readPartyEvidence({
//     paymentId: "7",
//     chainId: 11142220,
//     wallet: address,
//     signMessage: (msg) => signMessageAsync({ message: msg }),
//   });
// ---------------------------------------------------------------------------

export interface PartyChallengeResponse {
  challengeId: string;
  message: string;
  expiresAt: string;
  paymentId: string;
  chainId: number;
  escrowContractAddress: string;
  wallet: string;
  purpose: "evidence-read";
}

export interface PartyEvidence {
  title: string | null;
  claim: string | null;
  description: string | null;
  pastedText: string | null;
  date: string | null;
  externalRef: string | null;
  evidenceType: string | null;
  fileHash: string | null;
  fileCount: number;
  evidenceReference: string | null;
  submittedAt: string | null;
  submitter: string | null;
  availability: string | null;
}

function evidenceUrl(paymentId: string, suffix: string): string {
  return `/api/payments/${encodeURIComponent(paymentId)}/evidence/${suffix}`;
}

async function throwForError(res: Response, fallback: string): Promise<never> {
  let code = "";
  let error = fallback;
  try {
    const body = (await res.json()) as { code?: string; error?: string };
    if (body.code) code = body.code;
    if (body.error) error = body.error;
  } catch {
    // keep fallback
  }
  throw Object.assign(new Error(error), { code, status: res.status });
}

/** Request a short-lived evidence-read challenge for the connected wallet. */
export async function requestEvidenceChallenge(input: {
  paymentId: string;
  chainId: number;
  wallet: string;
  fetchFn?: typeof fetch;
}): Promise<PartyChallengeResponse> {
  const fetchFn = input.fetchFn ?? fetch;
  const res = await fetchFn(evidenceUrl(input.paymentId, "challenge"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chainId: input.chainId,
      wallet: input.wallet,
      purpose: "evidence-read",
    }),
  });
  if (!res.ok) await throwForError(res, "Failed to request the evidence challenge.");
  return (await res.json()) as PartyChallengeResponse;
}

/**
 * Full party read: challenge → sign → plaintext. The signMessage callback is
 * typically wagmi's signMessageAsync: `(message: string) => Promise<0x...>`.
 */
export async function readPartyEvidence(input: {
  paymentId: string;
  chainId: number;
  wallet: string;
  signMessage: (message: string) => Promise<string>;
  fetchFn?: typeof fetch;
}): Promise<PartyEvidence> {
  const fetchFn = input.fetchFn ?? fetch;
  const challenge = await requestEvidenceChallenge({
    paymentId: input.paymentId,
    chainId: input.chainId,
    wallet: input.wallet,
    fetchFn,
  });
  const signature = await input.signMessage(challenge.message);
  const res = await fetchFn(evidenceUrl(input.paymentId, "plaintext"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      challengeId: challenge.challengeId,
      signature,
      chainId: input.chainId,
      wallet: input.wallet,
    }),
  });
  if (!res.ok) await throwForError(res, "Failed to read the evidence.");
  const body = (await res.json()) as { evidence?: PartyEvidence; found?: boolean };
  if (!body.evidence) {
    throw Object.assign(new Error("Evidence is not available."), {
      code: "EVIDENCE_NOT_FOUND",
    });
  }
  return body.evidence;
}
