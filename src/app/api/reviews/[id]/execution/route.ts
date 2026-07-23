// ---------------------------------------------------------------------------
// I6B: GET /api/reviews/[id]/execution — check execution eligibility
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { requireReviewer } from "@/lib/reviewer/auth";
import { checkExecutionEligibility } from "@/lib/reviewer/execution/executor";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireReviewer(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id: paymentId } = await params;
  const url = new URL(request.url);
  const decisionId = url.searchParams.get("decisionId");

  if (!decisionId) {
    return NextResponse.json({ error: "decisionId query parameter is required." }, { status: 400 });
  }

  try {
    const eligibility = await checkExecutionEligibility(paymentId, decisionId);
    return NextResponse.json(eligibility);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
