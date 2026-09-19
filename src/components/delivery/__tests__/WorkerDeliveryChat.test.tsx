// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// WorkerDeliveryChat + DeliveryConfirmationCard — conversational worker
// delivery (P6.3).
//
// Parse API responses are stubbed (global fetch); the REAL
// @/lib/delivery/deliveryIntent helpers run underneath, so the ready →
// package → EvidenceFormData contract is verified end-to-end. No tx, no
// network, no wallet.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import WorkerDeliveryChat from "../WorkerDeliveryChat";
import DeliveryConfirmationCard from "../DeliveryConfirmationCard";
import { deliveryDraftToPackage } from "@/lib/delivery/deliveryIntent";
import type {
  DeliveryIntentDraft,
  DeliveryPackage,
} from "@/lib/delivery/deliveryIntent";

const WORKER = "0x2222222222222222222222222222222222222222";

type ChatProps = Parameters<typeof WorkerDeliveryChat>[0];

const FULL_DRAFT: DeliveryIntentDraft = {
  title: "Deployed marketing site",
  description: "Shipped the landing page to production",
  references: [
    {
      type: "url",
      label: "Delivery link",
      value: "https://example.com/site",
    },
  ],
  relatedDeliverable: "Landing page",
  deliveryDate: "2026-09-18",
  evidenceType: "delivery-file",
  pastedText: "",
};

function buildFixturePackage(): DeliveryPackage {
  const built = deliveryDraftToPackage(FULL_DRAFT, {
    paymentId: "7",
    chainId: 11142220,
    worker: WORKER,
  });
  if (built.pkg === null) {
    throw new Error(`Fixture draft should validate: ${built.errors.join(" ")}`);
  }
  return built.pkg;
}

const baseProps = (overrides: Partial<ChatProps> = {}): ChatProps => ({
  paymentIdStr: "7",
  chainId: 11142220,
  workerAddress: WORKER,
  deliverables: ["Landing page"],
  evidenceRequirements: ["Deployed URL"],
  agreementLabel: "Landing page build",
  protectedLabel: "100 USDC protected",
  releaseMode: "manual",
  onSubmitDelivery: vi.fn(),
  submitState: {
    isPending: false,
    isTxConfirmed: false,
    isSuccess: false,
    txHash: undefined,
    error: null,
    metadataState: "idle",
    metadataError: null,
  },
  onRequestPayment: vi.fn(),
  requestState: {
    isPending: false,
    isSuccess: false,
    error: null,
    txHash: undefined,
  },
  reviewStatus: "idle",
  ...overrides,
});

let root: Root | null = null;

async function mountChat(props: ChatProps) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<WorkerDeliveryChat {...props} />);
  });
  await act(async () => {});
}

async function mountCard(props: Parameters<typeof DeliveryConfirmationCard>[0]) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<DeliveryConfirmationCard {...props} />);
  });
  await act(async () => {});
}

async function rerenderChat(props: ChatProps) {
  await act(async () => {
    root!.render(<WorkerDeliveryChat {...props} />);
  });
  await act(async () => {});
}

function bodyText(): string {
  return document.body.textContent ?? "";
}

function clickFirstExample() {
  const buttons = Array.from(document.body.querySelectorAll("button"));
  const example = buttons.find((b) =>
    b.textContent?.includes("here's the deployed site"),
  );
  if (!example) throw new Error("No clickable example button found");
  return example;
}

async function sendExample() {
  await act(async () => {
    clickFirstExample().click();
  });
  await act(async () => {});
  await act(async () => {});
}

function parseBody(callIndex: number): Record<string, unknown> {
  const fetchMock = vi.mocked(globalThis.fetch);
  const init = fetchMock.mock.calls[callIndex]?.[1] as
    | { body?: string }
    | undefined;
  return JSON.parse((init?.body as string) ?? "{}") as Record<string, unknown>;
}

function readyResponse(draft: Record<string, unknown> = FULL_DRAFT) {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        ok: true,
        draft,
        missingFields: [],
        clarifyingQuestion: null,
        ready: true,
        rejected: false,
        boundaryMessage: null,
        errors: [],
        paymentId: "7",
        chainId: 11142220,
        worker: WORKER,
      }),
  };
}

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("WorkerDeliveryChat — conversational delivery", () => {
  it("(a) worker sees the conversational box (label, placeholder, examples, scope)", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await mountChat(baseProps());
    const input = document.getElementById(
      "delivery-chat-input",
    ) as HTMLTextAreaElement | null;
    expect(input).not.toBeNull();
    expect(input!.placeholder).toContain("here's the deployed site");
    const label = document.querySelector("label[for='delivery-chat-input']");
    expect(label?.textContent).toContain("Tell Reclaim what you delivered");
    expect(bodyText()).toContain("Tell Reclaim what you delivered");
    expect(bodyText()).toContain("Finished the logo");
    expect(bodyText()).toContain("The repo is here");
    expect(bodyText()).toContain(
      "delivery, evidence, job status and payment readiness only",
    );
    const manual = document.body.querySelector(
      "a[href='/payments/7/evidence?chainId=11142220']",
    );
    expect(manual).not.toBeNull();
    expect(manual!.textContent).toContain("Add evidence manually");
  });

  it("(b) confirmation card matches validated evidence after a ready response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(readyResponse());
    vi.stubGlobal("fetch", fetchMock);
    await mountChat(baseProps());
    await sendExample();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/payments/7/delivery/parse");
    const sent = JSON.parse(
      (init as { body: string }).body,
    ) as Record<string, unknown>;
    expect(sent.message).toContain("here's the deployed site");
    expect(sent.paymentContext).toEqual({
      chainId: 11142220,
      worker: WORKER,
      deliverables: ["Landing page"],
      evidenceRequirements: ["Deployed URL"],
      agreementLabel: "Landing page build",
    });
    expect(bodyText()).toContain("You're submitting");
    expect(bodyText()).toContain("Deployed marketing site");
    expect(bodyText()).toContain("Shipped the landing page");
    expect(bodyText()).toContain("Delivery link");
    expect(bodyText()).toContain("https://example.com/site");
    expect(bodyText()).toContain("Landing page");
    expect(bodyText()).toContain("100 USDC protected");
  });

  it("(c) nothing submits before an explicit click", async () => {
    const fetchMock = vi.fn().mockResolvedValue(readyResponse());
    vi.stubGlobal("fetch", fetchMock);
    const onSubmitDelivery = vi.fn();
    await mountChat(baseProps({ onSubmitDelivery }));
    await sendExample();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyText()).toContain("You're submitting");
    // Ready + confirmed, but no broadcast without the explicit click.
    expect(onSubmitDelivery).not.toHaveBeenCalled();

    const submit = Array.from(
      document.body.querySelectorAll("button"),
    ).find((b) => b.textContent === "Submit delivery");
    expect(submit).not.toBeUndefined();
    await act(async () => {
      submit!.click();
    });
    await act(async () => {});
    expect(onSubmitDelivery).toHaveBeenCalledTimes(1);
  });

  it("(d) clarification preserves the prior draft across messages", async () => {
    const firstDraft = { title: "Deployed site" };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            ok: true,
            draft: firstDraft,
            missingFields: ["evidence"],
            clarifyingQuestion: "Where can the client see it?",
            ready: false,
            rejected: false,
            boundaryMessage: null,
            errors: [],
            paymentId: "7",
            chainId: 11142220,
            worker: WORKER,
          }),
      })
      .mockResolvedValueOnce(readyResponse());
    vi.stubGlobal("fetch", fetchMock);
    await mountChat(baseProps());

    await sendExample();
    expect(bodyText()).toContain("Where can the client see it?");
    expect(bodyText()).toContain("Still needed: evidence.");
    expect(bodyText()).not.toContain("You're submitting");

    await sendExample();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Second message carries the accumulated draft from the first response.
    const secondBody = parseBody(1);
    expect(secondBody.draft).toEqual(firstDraft);
    // Transcript accumulates both worker lines.
    const messagesText = String(secondBody.messagesText ?? "");
    expect(messagesText.match(/worker:/g)?.length).toBe(2);
    expect(bodyText()).toContain("You're submitting");
  });

  it("(e) unrelated prompt shows the boundary and never confirms", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          ok: true,
          draft: {},
          missingFields: [],
          clarifyingQuestion: null,
          ready: false,
          rejected: true,
          boundaryMessage:
            "Reclaim handles delivery evidence for this payment — nothing else.",
          errors: [],
          paymentId: "7",
          chainId: 11142220,
          worker: WORKER,
        }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const onSubmitDelivery = vi.fn();
    await mountChat(baseProps({ onSubmitDelivery }));
    await sendExample();

    expect(bodyText()).toContain(
      "Reclaim handles delivery evidence for this payment",
    );
    expect(bodyText()).not.toContain("You're submitting");
    expect(onSubmitDelivery).not.toHaveBeenCalled();
  });

  it("(f) mapped evidence carries the primary URL and submits exactly once", async () => {
    const fetchMock = vi.fn().mockResolvedValue(readyResponse());
    vi.stubGlobal("fetch", fetchMock);
    const onSubmitDelivery = vi.fn();
    await mountChat(baseProps({ onSubmitDelivery }));
    await sendExample();

    const submit = Array.from(
      document.body.querySelectorAll("button"),
    ).find((b) => b.textContent === "Submit delivery");
    await act(async () => {
      submit!.click();
    });
    await act(async () => {});

    expect(onSubmitDelivery).toHaveBeenCalledTimes(1);
    const submitted = onSubmitDelivery.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    // Real deliveryPackageToEvidenceFormData mapping: primary URL ref,
    // related deliverable, evidence type, delivery date.
    expect(submitted.externalRef).toBe("https://example.com/site");
    expect(submitted.title).toBe("Deployed marketing site");
    expect(submitted.relatedClaim).toBe("Landing page");
    expect(submitted.type).toBe("delivery-file");
    expect(submitted.date).toBe("2026-09-18");
  });

  it("(g) request-payment calls back once and locks after success", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const onRequestPayment = vi.fn();
    const props = baseProps({
      releaseMode: "agent_assisted",
      onRequestPayment,
      submitState: {
        isPending: false,
        isTxConfirmed: true,
        isSuccess: true,
        txHash: "0xdeliver123",
        error: null,
        metadataState: "persisted",
        metadataError: null,
      },
    });
    await mountChat(props);

    expect(bodyText()).toContain("Delivery submitted");
    expect(bodyText()).toContain("0xdeliver123");
    expect(bodyText()).toContain(
      "Reclaim is checking your delivery against the agreed terms.",
    );
    expect(bodyText()).toContain("nothing is auto-signed");
    const request = Array.from(
      document.body.querySelectorAll("button"),
    ).find((b) => b.textContent === "Request payment");
    expect(request).not.toBeUndefined();
    await act(async () => {
      request!.click();
    });
    await act(async () => {});
    expect(onRequestPayment).toHaveBeenCalledTimes(1);

    await rerenderChat({
      ...props,
      requestState: {
        isPending: false,
        isSuccess: true,
        error: null,
        txHash: "0xrequest123",
      },
    });
    const confirmed = Array.from(
      document.body.querySelectorAll("button"),
    ).find((b) => b.textContent === "Request confirmed");
    expect(confirmed).not.toBeUndefined();
    expect((confirmed as HTMLButtonElement).disabled).toBe(true);
  });

  it("surfaces transport failures without losing the thread", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);
    const onSubmitDelivery = vi.fn();
    await mountChat(baseProps({ onSubmitDelivery }));
    await sendExample();

    expect(bodyText()).toContain("Nothing was submitted");
    expect(bodyText()).not.toContain("You're submitting");
    expect(onSubmitDelivery).not.toHaveBeenCalled();
  });

  it("editing returns to the thread with the draft intact", async () => {
    const fetchMock = vi.fn().mockResolvedValue(readyResponse());
    vi.stubGlobal("fetch", fetchMock);
    const onSubmitDelivery = vi.fn();
    await mountChat(baseProps({ onSubmitDelivery }));
    await sendExample();
    expect(bodyText()).toContain("You're submitting");

    const edit = Array.from(
      document.body.querySelectorAll("button"),
    ).find((b) => b.textContent === "Edit details");
    await act(async () => {
      edit!.click();
    });
    await act(async () => {});
    expect(bodyText()).not.toContain("You're submitting");
    expect(
      document.getElementById("delivery-chat-input"),
    ).not.toBeNull();
    expect(onSubmitDelivery).not.toHaveBeenCalled();
  });
});

describe("DeliveryConfirmationCard — confirm-before-submit", () => {
  it("renders validated values with exact privacy + advisory copy, never verified", async () => {
    const onSubmit = vi.fn();
    const onEdit = vi.fn();
    await mountCard({
      pkg: buildFixturePackage(),
      protectedLabel: "100 USDC protected",
      onSubmit,
      onEdit,
      isSubmitting: false,
      submitError: null,
    });

    expect(bodyText()).toContain("You're submitting");
    expect(bodyText()).toContain("Deployed marketing site");
    expect(bodyText()).toContain("Delivery link");
    expect(bodyText()).toContain("https://example.com/site");
    expect(bodyText()).toContain("100 USDC protected");
    expect(bodyText()).toContain(
      "Reclaim will record a hash of this delivery on-chain. Private delivery details remain available only to authorized payment parties.",
    );
    expect(bodyText()).toContain(
      "This has not been verified yet — the client reviews it before any release.",
    );
    expect(bodyText().toLowerCase()).not.toContain("verified delivery");
    expect(bodyText()).not.toContain("guarantee");

    const submit = Array.from(
      document.body.querySelectorAll("button"),
    ).find((b) => b.textContent === "Submit delivery");
    await act(async () => {
      submit!.click();
    });
    await act(async () => {});
    expect(onSubmit).toHaveBeenCalledTimes(1);

    const edit = Array.from(
      document.body.querySelectorAll("button"),
    ).find((b) => b.textContent === "Edit details");
    await act(async () => {
      edit!.click();
    });
    await act(async () => {});
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("disables submit while pending and surfaces submit errors", async () => {
    await mountCard({
      pkg: buildFixturePackage(),
      protectedLabel: "100 USDC protected",
      onSubmit: vi.fn(),
      onEdit: vi.fn(),
      isSubmitting: true,
      submitError: "Wallet rejected the signature.",
    });

    const submit = Array.from(
      document.body.querySelectorAll("button"),
    ).find((b) => b.textContent === "Submitting…");
    expect(submit).not.toBeUndefined();
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(bodyText()).toContain("Wallet rejected the signature.");
  });
});
