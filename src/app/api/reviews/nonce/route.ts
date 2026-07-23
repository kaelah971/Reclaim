// ---------------------------------------------------------------------------
// I6A: GET /api/reviews/nonce — reviewer authentication challenge
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { createAuthChallenge } from "@/lib/reviewer/auth";

export async function GET(): Promise<Response> {
  const challenge = await createAuthChallenge();
  return NextResponse.json({
    nonce: challenge.nonce,
    message: challenge.message,
  });
}
