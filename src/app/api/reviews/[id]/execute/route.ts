// ---------------------------------------------------------------------------
// I6B: POST /api/reviews/[id]/execute — execute reviewer decision on-chain
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { requireReviewer } from "@/lib/reviewer/auth";
import { executeDisputeResolution } from "@/lib/reviewer/execution/executor";
import { z } from "zod";

const executeSchema = z.object({
  decisionId: z.string().uuid(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireReviewer(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id: paymentId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parseResult = executeSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: "decisionId (UUID) is required." }, { status: 400 });
  }

  try {
    const result = await executeDisputeResolution(paymentId, parseResult.data.decisionId);
    const status = result.success ? 200 : result.dryRun ? 200 : 422;
    return NextResponse.json(result, { status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
