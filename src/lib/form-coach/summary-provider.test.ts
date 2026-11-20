import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createFormCoachSummaryProvider,
  FORM_COACH_SUMMARY_MAX_OUTPUT_TOKENS,
  FORM_COACH_SUMMARY_TIMEOUT_MS,
  NUMERIC_SUMMARY_FIELDS,
  type NumericAttemptSummary,
} from "./summary-provider";
import {
  FORM_COACH_SUMMARY_PROMPT_VERSION,
  FORM_COACH_SUMMARY_SYSTEM_PROMPT,
} from "./summary-prompt";

const apiKey = "test-only-api-key-that-must-not-leak";
type TestEnvironment = Readonly<{
  FORM_COACH_LLM_PROVIDER?: string;
  FORM_COACH_LLM_MODEL?: string;
  FORM_COACH_LLM_API_KEY?: string;
}>;

const env: TestEnvironment = {
  FORM_COACH_LLM_PROVIDER: "openai",
  FORM_COACH_LLM_MODEL: "gpt-6-luna",
  FORM_COACH_LLM_API_KEY: apiKey,
} as const;

const summary: NumericAttemptSummary = {
  rep_count: 5,
  average_score: 84,
  minimum_score: 70,
  maximum_score: 92,
  rom_min_angle_average: 30,
  rom_max_angle_average: 120,
  rom_average: 86,
  elbow_average: 82,
  torso_average: 90,
  tempo_average: 85,
  shoulders_average: 84,
  max_upper_arm_drift: 24,
  max_torso_swing: 12,
  max_shrug: 0.22,
  concentric_ms_average: 950,
  top_pause_ms_average: 180,
  eccentric_ms_average: 1_100,
  curve_similarity_average: 88,
  elbow_drift_count: 1,
  torso_swing_count: 0,
  short_rom_count: 0,
  shoulder_shrug_count: 1,
};

type ResponseFixture = Record<string, unknown>;
type CapturedRequest = {
  url: string;
  body: Record<string, unknown>;
  authorization: string | null;
  hasAbortSignal: boolean;
};

function openAIResponse(text: string): ResponseFixture {
  return {
    id: "resp_synthetic",
    created_at: 1,
    model: "gpt-6-luna",
    output: [
      {
        id: "msg_synthetic",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text, annotations: [] }],
      },
    ],
    usage: {
      input_tokens: 64,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 32,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 96,
    },
  };
}

function refusalResponse(): ResponseFixture {
  return {
    ...openAIResponse(""),
    output: [
      {
        id: "msg_synthetic",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "refusal", refusal: "Synthetic blocked response." }],
      },
    ],
  };
}

function createFetchMock(
  response: ResponseFixture = openAIResponse(
    "Your average score was 84 across five reps. Keep your elbows steady through the next set.",
  ),
  status = 200,
) {
  const captured: CapturedRequest[] = [];
  const fetchImpl: typeof fetch = vi.fn(async (input, init) => {
    const request =
      input instanceof Request ? input : new Request(input, init);
    const body = (await request.json()) as Record<string, unknown>;
    captured.push({
      url: request.url,
      body,
      authorization: request.headers.get("authorization"),
      hasAbortSignal: request.signal instanceof AbortSignal,
    });
    return new Response(JSON.stringify(response), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
  return { fetchImpl, captured };
}

function createProvider(
  fetchImpl: typeof fetch,
  providerEnv: TestEnvironment = env,
) {
  return createFormCoachSummaryProvider({ env: providerEnv, fetchImpl });
}

describe("Form Coach summary provider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("sends only the fixed numeric prompt through the bounded OpenAI Responses request", async () => {
    const { fetchImpl, captured } = createFetchMock();
    const provider = createProvider(fetchImpl);

    const result = await provider.summarize(summary);

    expect(result).toEqual({
      status: "ready",
      promptVersion: FORM_COACH_SUMMARY_PROMPT_VERSION,
      text: "Your average score was 84 across five reps. Keep your elbows steady through the next set.",
    });
    expect(captured).toHaveLength(1);
    const request = captured[0];
    expect(new URL(request.url).origin).toBe("https://api.openai.com");
    expect(new URL(request.url).pathname).toBe("/v1/responses");
    expect(request.authorization).toBe(`Bearer ${apiKey}`);
    expect(request.hasAbortSignal).toBe(true);
    expect(request.body.model).toBe("gpt-6-luna");
    expect(request.body.store).toBe(false);
    expect(request.body.reasoning).toEqual({ effort: "none" });
    expect(request.body.include).toEqual(["reasoning.encrypted_content"]);
    expect(request.body.max_output_tokens).toBe(FORM_COACH_SUMMARY_MAX_OUTPUT_TOKENS);
    const input = request.body.input as Array<{
      role: string;
      content: string | Array<{ text?: string }>;
    }>;
    expect(input[0]).toEqual({
      role: "developer",
      content: FORM_COACH_SUMMARY_SYSTEM_PROMPT,
    });
    expect(input[1].role).toBe("user");
    const userText = Array.isArray(input[1].content)
      ? input[1].content[0]?.text
      : input[1].content;
    expect(userText).toContain("Numeric measurements for one completed attempt:");
    const submittedJson = userText?.split("\n").at(-1);
    expect(submittedJson).toBe(JSON.stringify(summary));
    expect(JSON.stringify(request.body)).not.toContain(apiKey);
    expect(request.body).not.toHaveProperty("tools");
    expect(request.body).not.toHaveProperty("user");
    expect(request.body).not.toHaveProperty("metadata");
    expect(request.body).not.toHaveProperty("previous_response_id");
    expect(request.body).not.toHaveProperty("conversation");
  });

  it.each([
    ["provider", { FORM_COACH_LLM_MODEL: env.FORM_COACH_LLM_MODEL, FORM_COACH_LLM_API_KEY: apiKey }],
    ["model", { FORM_COACH_LLM_PROVIDER: "openai", FORM_COACH_LLM_API_KEY: apiKey }],
    ["API key", { FORM_COACH_LLM_PROVIDER: "openai", FORM_COACH_LLM_MODEL: env.FORM_COACH_LLM_MODEL }],
  ])("returns unconfigured without network when %s is missing", async (_name, missingEnv) => {
    const { fetchImpl } = createFetchMock();
    const provider = createProvider(fetchImpl, missingEnv);

    await expect(provider.summarize(summary)).resolves.toEqual({
      status: "unconfigured",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not use the generic OpenAI key or model when Form Coach configuration is absent", async () => {
    vi.stubEnv("OPENAI_API_KEY", "global-key-must-not-be-used");
    vi.stubEnv("OPENAI_MODEL", "global-model-must-not-be-used");
    const { fetchImpl } = createFetchMock();
    const provider = createProvider(fetchImpl, {});

    await expect(provider.summarize(summary)).resolves.toEqual({
      status: "unconfigured",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects malformed or non-numeric summaries before provider access", async () => {
    const { fetchImpl } = createFetchMock();
    const provider = createProvider(fetchImpl);
    const withIdentity = { ...summary, member_id: "private-id" };
    const withNaN = { ...summary, average_score: Number.NaN };
    const inconsistent = { ...summary, minimum_score: 90 };
    const impossibleFaultCount = { ...summary, elbow_drift_count: 6 };
    const withInfinity = { ...summary, max_torso_swing: Number.POSITIVE_INFINITY };
    const withMissingField = { ...summary } as Record<string, number>;
    delete withMissingField.short_rom_count;

    for (const value of [
      null,
      [],
      withIdentity,
      withNaN,
      inconsistent,
      impossibleFaultCount,
      withInfinity,
      withMissingField,
      { ...summary, rep_count: 21 },
    ]) {
      await expect(provider.summarize(value)).resolves.toEqual({
        status: "invalid_input",
      });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects enumerable getters without invoking them", async () => {
    const { fetchImpl } = createFetchMock();
    const provider = createProvider(fetchImpl);
    const value = { ...summary } as Record<string, number>;
    const getter = vi.fn(() => 84);
    Object.defineProperty(value, "average_score", {
      enumerable: true,
      configurable: true,
      get: getter,
    });

    await expect(provider.summarize(value)).resolves.toEqual({
      status: "invalid_input",
    });
    expect(getter).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [408, { status: "retryable", category: "timeout" }],
    [429, { status: "retryable", category: "rate_limited" }],
    [503, { status: "retryable", category: "provider_unavailable" }],
    [401, { status: "unavailable", category: "provider_auth" }],
    [400, { status: "unavailable", category: "provider_rejected" }],
  ] as const)("sanitizes provider HTTP %s failures", async (status, expected) => {
    const body = {
      error: {
        message: `Synthetic failure with ${apiKey}`,
        type: "synthetic_error",
        code: "synthetic_code",
      },
    };
    const { fetchImpl } = createFetchMock(body, status);
    const provider = createProvider(fetchImpl);

    const result = await provider.summarize(summary);

    expect(result).toEqual(expected);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain(apiKey);
    expect(JSON.stringify(result)).not.toContain("Synthetic failure");
  });

  it("classifies transport timeouts as retryable without exposing the error", async () => {
    const fetchImpl: typeof fetch = vi.fn(async () => {
      throw new DOMException("Synthetic timeout detail", "TimeoutError");
    });
    const provider = createProvider(fetchImpl);

    const result = await provider.summarize(summary);

    expect(result).toEqual({ status: "retryable", category: "timeout" });
    expect(JSON.stringify(result)).not.toContain("Synthetic timeout detail");
  });

  it("classifies network failures as retryable without exposing their cause", async () => {
    const fetchImpl: typeof fetch = vi.fn(async () => {
      const cause = Object.assign(
        new Error(`Synthetic network failure ${apiKey}`),
        { code: "ECONNREFUSED" },
      );
      throw new TypeError("fetch failed", { cause });
    });
    const provider = createProvider(fetchImpl);

    const result = await provider.summarize(summary);

    expect(result).toEqual({ status: "retryable", category: "network" });
    expect(JSON.stringify(result)).not.toContain(apiKey);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("aborts a hanging fetch at the configured deadline without retrying", async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
      const controller = new AbortController();
      setTimeout(
        () => controller.abort(new DOMException("Synthetic timeout", "TimeoutError")),
        milliseconds,
      );
      return controller.signal;
    });
    let transportSignal: AbortSignal | undefined;
    const fetchImpl: typeof fetch = vi.fn((input, init) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      transportSignal = request.signal;
      return new Promise<Response>((_resolve, reject) => {
        request.signal.addEventListener(
          "abort",
          () => reject(new DOMException("Synthetic timeout", "AbortError")),
          { once: true },
        );
      });
    });
    const provider = createProvider(fetchImpl);

    const pending = provider.summarize(summary);
    await vi.advanceTimersByTimeAsync(FORM_COACH_SUMMARY_TIMEOUT_MS);
    const result = await pending;

    expect(transportSignal?.aborted).toBe(true);
    expect(result).toEqual({ status: "retryable", category: "timeout" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects non-2-to-4 sentence, HTML, and oversized generated text", async () => {
    const responses = [
      openAIResponse("One sentence only."),
      openAIResponse("This output is <b>markup</b>. Keep it plain."),
      openAIResponse(`${"x".repeat(1_001)}. Second sentence.`),
    ];

    for (const response of responses) {
      const { fetchImpl } = createFetchMock(response);
      const provider = createProvider(fetchImpl);
      await expect(provider.summarize(summary)).resolves.toEqual({
        status: "unavailable",
        category: "invalid_output",
      });
    }
  });

  it("marks empty, blocked, and truncated outputs without returning provider text", async () => {
    const empty = createProvider(createFetchMock(openAIResponse("   ")).fetchImpl);
    await expect(empty.summarize(summary)).resolves.toEqual({
      status: "unavailable",
      category: "empty_output",
    });

    const blocked = createProvider(createFetchMock(refusalResponse()).fetchImpl);
    await expect(blocked.summarize(summary)).resolves.toEqual({
      status: "unavailable",
      category: "blocked",
    });

    const truncatedResponse = {
      ...openAIResponse("A partial output."),
      incomplete_details: { reason: "max_output_tokens" },
    };
    const truncated = createProvider(
      createFetchMock(truncatedResponse).fetchImpl,
    );
    await expect(truncated.summarize(summary)).resolves.toEqual({
      status: "unavailable",
      category: "truncated",
    });
  });

  it("keeps its SDK call deadline bounded", () => {
    expect(FORM_COACH_SUMMARY_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
    expect(FORM_COACH_SUMMARY_TIMEOUT_MS).toBeGreaterThan(0);
    expect(NUMERIC_SUMMARY_FIELDS).toHaveLength(22);
  });
});
