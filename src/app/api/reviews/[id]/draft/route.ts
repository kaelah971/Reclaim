// ---------------------------------------------------------------------------
// I6A: POST /api/reviews/[id]/draft — save reviewer draft decision
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { requireReviewer } from "@/lib/reviewer/auth";
import { createDraftDecision, getDecisionsForPayment } from "@/lib/reviewer/store";
import { z } from "zod";

const draftSchema = z.object({
  decision: z.enum(["release_to_worker", "refund_to_client", "partial_resolution", "needs_more_evidence"]),
  rationale: z.string().min(20, "Rationale must be at least 20 characters."),
  evidenceNotes: z.string().optional(),
  conditions: z.string().optional(),
  clientAmount: z.string().optional(),
  workerAmount: z.string().optional(),
  disputeIdentifier: z.string().optional(),
  sourceBriefVersion: z.string().optional(),
  sourceRequestHash: z.string().optional(),
}).refine((data) => {
  if (data.decision === "partial_resolution") {
    return !!data.clientAmount && !!data.workerAmount;
  }
  return true;
}, { message: "Partial resolution requires clientAmount and workerAmount." });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  let reviewerAddress: string;
  try {
    reviewerAddress = await requireReviewer(request);
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

  const parseResult = draftSchema.safeParse(body);
  if (!parseResult.success) {
    const errors: Record<string, string[]> = {};
    for (const issue of parseResult.error.issues) {
      const path = issue.path.join(".") || "_root";
      if (!errors[path]) errors[path] = [];
      errors[path].push(issue.message);
    }
    return NextResponse.json({ error: "Validation failed.", details: errors }, { status: 400 });
  }

  const data = parseResult.data;

  try {
    // Check for existing drafts from same reviewer
    const existing = await getDecisionsForPayment(paymentId);
    const existingDraft = existing.find(
      (d) => d.reviewer_address.toLowerCase() === reviewerAddress.toLowerCase() && d.decision_status === "draft",
    );

    if (existingDraft) {
      // Update existing draft instead
      const { updateDraftDecision } = await import("@/lib/reviewer/store");
      const updated = await updateDraftDecision(existingDraft.id, reviewerAddress, {
        decision: data.decision,
        rationale: data.rationale,
        evidence_notes: data.evidenceNotes,
        conditions: data.conditions,
        client_amount: data.clientAmount,
        worker_amount: data.workerAmount,
      });

      if (updated) {
        return NextResponse.json({ success: true, decision: updated, action: "updated" });
      }
    }

    const record = await createDraftDecision({
      payment_identifier: paymentId,
      dispute_identifier: data.disputeIdentifier,
      reviewer_address: reviewerAddress,
      decision: data.decision,
      rationale: data.rationale,
      evidence_notes: data.evidenceNotes,
      conditions: data.conditions,
      client_amount: data.clientAmount,
      worker_amount: data.workerAmount,
      source_brief_version: data.sourceBriefVersion,
      source_request_hash: data.sourceRequestHash,
    });

    if (!record) {
      return NextResponse.json({ error: "Failed to save draft." }, { status: 500 });
    }

    return NextResponse.json({ success: true, decision: record, action: "created" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
