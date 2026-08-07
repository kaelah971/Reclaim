import { describe, it, expect } from "vitest";
import {
  ResolutionAgentEvidenceRequestError,
  ResolutionAgentEvidenceRequestIdentityMismatchError,
  ResolutionAgentEvidenceRequestStalePlanError,
  ResolutionAgentEvidenceRequestUnauthorizedPartyError,
  ResolutionAgentEvidenceRequestConflictError,
  ResolutionAgentEvidenceRequestStateError,
} from "../errors";

describe("ResolutionAgentEvidenceRequestError", () => {
  it("has correct name and code", () => {
    const err = new ResolutionAgentEvidenceRequestError("test message", "TEST_CODE");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ResolutionAgentEvidenceRequestError");
    expect(err.code).toBe("TEST_CODE");
    expect(err.message).toBe("test message");
  });
});

describe("ResolutionAgentEvidenceRequestIdentityMismatchError", () => {
  it("has correct name and code", () => {
    const err = new ResolutionAgentEvidenceRequestIdentityMismatchError("identity mismatch");
    expect(err).toBeInstanceOf(ResolutionAgentEvidenceRequestError);
    expect(err.name).toBe("ResolutionAgentEvidenceRequestIdentityMismatchError");
    expect(err.code).toBe("EVIDENCE_REQUEST_IDENTITY_MISMATCH");
  });
});

describe("ResolutionAgentEvidenceRequestStalePlanError", () => {
  it("has correct name and code", () => {
    const err = new ResolutionAgentEvidenceRequestStalePlanError("stale plan");
    expect(err).toBeInstanceOf(ResolutionAgentEvidenceRequestError);
    expect(err.name).toBe("ResolutionAgentEvidenceRequestStalePlanError");
    expect(err.code).toBe("EVIDENCE_REQUEST_STALE_PLAN");
  });
});

describe("ResolutionAgentEvidenceRequestUnauthorizedPartyError", () => {
  it("has correct name and code", () => {
    const err = new ResolutionAgentEvidenceRequestUnauthorizedPartyError("bad party");
    expect(err).toBeInstanceOf(ResolutionAgentEvidenceRequestError);
    expect(err.name).toBe("ResolutionAgentEvidenceRequestUnauthorizedPartyError");
    expect(err.code).toBe("EVIDENCE_REQUEST_UNAUTHORIZED_PARTY");
  });
});

describe("ResolutionAgentEvidenceRequestConflictError", () => {
  it("has correct name and code", () => {
    const err = new ResolutionAgentEvidenceRequestConflictError("conflict");
    expect(err).toBeInstanceOf(ResolutionAgentEvidenceRequestError);
    expect(err.name).toBe("ResolutionAgentEvidenceRequestConflictError");
    expect(err.code).toBe("EVIDENCE_REQUEST_CONFLICT");
  });
});

describe("ResolutionAgentEvidenceRequestStateError", () => {
  it("has correct name and code", () => {
    const err = new ResolutionAgentEvidenceRequestStateError("state error");
    expect(err).toBeInstanceOf(ResolutionAgentEvidenceRequestError);
    expect(err.name).toBe("ResolutionAgentEvidenceRequestStateError");
    expect(err.code).toBe("EVIDENCE_REQUEST_STATE_ERROR");
  });
});
