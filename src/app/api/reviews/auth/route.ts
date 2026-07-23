// ---------------------------------------------------------------------------
// I6A: POST /api/reviews/auth — reviewer authentication
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { authenticateReviewer } from "@/lib/reviewer/auth";

export async function POST(request: Request): Promise<Response> {
  let body: { signature?: string; message?: string; nonce?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.signature || !body.message || !body.nonce) {
    return NextResponse.json(
      { error: "signature, message, and nonce are required." },
      { status: 400 },
    );
  }

  const result = await authenticateReviewer(body.signature, body.message, body.nonce);

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 403 });
  }

  return NextResponse.json({
    success: true,
    address: result.address,
    sessionToken: result.sessionToken,
  });
}
