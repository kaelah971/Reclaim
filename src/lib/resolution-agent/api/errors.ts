// ---------------------------------------------------------------------------
// Resolution Agent API — shared error normalizer
//
// All route handlers use this to produce safe, normalized error responses
// that never leak raw database errors, stack traces, or RPC internals.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import {
  InvalidAgentStateTransitionError,
  PolicyViolationError,
} from "../errors";
import {
  ResolutionAgentStoreError,
  ResolutionAgentNotFoundError,
  ResolutionAgentAlreadyExistsError,
  ResolutionAgentConcurrencyError,
} from "../store/errors";

// ---------------------------------------------------------------------------
// Normalized error response shape
// ---------------------------------------------------------------------------

export interface NormalizedError {
  error: string;
  code?: string;
}

// ---------------------------------------------------------------------------
// Map known domain errors to HTTP status codes and safe messages
// ---------------------------------------------------------------------------

function classifyDomainError(
  err: unknown,
): { status: number; body: NormalizedError } | null {
  if (err instanceof ResolutionAgentNotFoundError) {
    return {
      status: 404,
      body: { error: "Resolution agent not found.", code: "AGENT_NOT_FOUND" },
    };
  }

  if (err instanceof ResolutionAgentAlreadyExistsError) {
    return {
      status: 409,
      body: {
        error: "A resolution agent already exists for this case identity.",
        code: "AGENT_ALREADY_EXISTS",
      },
    };
  }

  if (err instanceof ResolutionAgentConcurrencyError) {
    return {
      status: 409,
      body: {
        error: "The agent was modified by another request. Please retry.",
        code: "CONCURRENCY_CONFLICT",
      },
    };
  }

  if (err instanceof InvalidAgentStateTransitionError) {
    return {
      status: 422,
      body: { error: err.message, code: "INVALID_STATE_TRANSITION" },
    };
  }

  if (err instanceof PolicyViolationError) {
    return {
      status: 403,
      body: { error: err.message, code: "POLICY_VIOLATION" },
    };
  }

  if (err instanceof ResolutionAgentStoreError) {
    return {
      status: 500,
      body: { error: "Internal storage error.", code: "STORE_ERROR" },
    };
  }

  // Generic Error with message — only surface the message, never the stack
  if (err instanceof Error) {
    return {
      status: 500,
      body: { error: `Internal server error: ${err.message}` },
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert any caught error into a safe, normalised NextResponse.
 *
 * Rules:
 * - Known domain errors map to specific HTTP codes + safe messages.
 * - Unknown errors yield a generic 500 without any raw internals.
 * - Errors are logged server-side with the provided correlationId.
 */
export function toErrorResponse(
  err: unknown,
  correlationId: string,
): NextResponse<NormalizedError> {
  const classified = classifyDomainError(err);

  if (classified) {
    console.error(
      `[resolution-agents][${correlationId}] ${classified.status} ${classified.body.code ?? "ERROR"}: ${classified.body.error}`,
    );
    return NextResponse.json(classified.body, { status: classified.status });
  }

  // Fallback: completely unknown error type
  console.error(
    `[resolution-agents][${correlationId}] Unhandled error:`,
    err instanceof Error ? err.message : String(err),
  );
  return NextResponse.json(
    { error: "Internal server error." },
    { status: 500 },
  );
}
