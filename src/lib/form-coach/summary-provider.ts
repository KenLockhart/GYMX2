import "server-only";

import { createOpenAI } from "@ai-sdk/openai";
import { APICallError, generateText } from "ai";
import {
  buildFormCoachSummaryPrompt,
  FORM_COACH_SUMMARY_PROMPT_VERSION,
  FORM_COACH_SUMMARY_SYSTEM_PROMPT,
} from "./summary-prompt";

export const FORM_COACH_SUMMARY_TIMEOUT_MS = 8_000;
export const FORM_COACH_SUMMARY_MAX_OUTPUT_TOKENS = 180;
const OPENAI_BASE_URL = "https://api.openai.com/v1";

export const NUMERIC_SUMMARY_FIELDS = [
  "rep_count",
  "average_score",
  "minimum_score",
  "maximum_score",
  "rom_min_angle_average",
  "rom_max_angle_average",
  "rom_average",
  "elbow_average",
  "torso_average",
  "tempo_average",
  "shoulders_average",
  "max_upper_arm_drift",
  "max_torso_swing",
  "max_shrug",
  "concentric_ms_average",
  "top_pause_ms_average",
  "eccentric_ms_average",
  "curve_similarity_average",
  "elbow_drift_count",
  "torso_swing_count",
  "short_rom_count",
  "shoulder_shrug_count",
] as const;

export type NumericSummaryField = (typeof NUMERIC_SUMMARY_FIELDS)[number];
export type NumericAttemptSummary = Readonly<Record<NumericSummaryField, number>>;

export type FormCoachSummaryResult =
  | {
      status: "ready";
      promptVersion: typeof FORM_COACH_SUMMARY_PROMPT_VERSION;
      text: string;
    }
  | { status: "unconfigured" }
  | { status: "invalid_input" }
  | {
      status: "retryable";
      category: "timeout" | "rate_limited" | "provider_unavailable" | "network";
    }
  | {
      status: "unavailable";
      category:
        | "provider_auth"
        | "provider_rejected"
        | "blocked"
        | "truncated"
        | "empty_output"
        | "invalid_output"
        | "provider_error";
    };

type SummaryEnvironment = Readonly<{
  FORM_COACH_LLM_PROVIDER?: string;
  FORM_COACH_LLM_MODEL?: string;
  FORM_COACH_LLM_API_KEY?: string;
}>;

type ProviderOptions = Readonly<{
  env?: SummaryEnvironment;
  fetchImpl?: typeof fetch;
  monotonicNow?: () => number;
}>;

export type FormCoachSummaryRequestOptions = Readonly<{
  signal?: AbortSignal;
  timeoutMs?: number;
  deadlineAtMonotonic?: number;
}>;

type SummaryConfig = Readonly<{ model: string; apiKey: string }>;

const SCORE_FIELDS = [
  "average_score",
  "minimum_score",
  "maximum_score",
  "rom_average",
  "elbow_average",
  "torso_average",
  "tempo_average",
  "shoulders_average",
  "curve_similarity_average",
] as const satisfies readonly NumericSummaryField[];

const ANGLE_FIELDS = [
  "rom_min_angle_average",
  "rom_max_angle_average",
  "max_upper_arm_drift",
  "max_torso_swing",
] as const satisfies readonly NumericSummaryField[];

const FAULT_COUNT_FIELDS = [
  "elbow_drift_count",
  "torso_swing_count",
  "short_rom_count",
  "shoulder_shrug_count",
] as const satisfies readonly NumericSummaryField[];

function normalizeNumericSummary(value: unknown): NumericAttemptSummary | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    if (Object.getOwnPropertySymbols(value).length !== 0) return null;

    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== NUMERIC_SUMMARY_FIELDS.length ||
      keys.some(
        (key) =>
          typeof key !== "string" ||
          !NUMERIC_SUMMARY_FIELDS.includes(key as NumericSummaryField),
      )
    ) {
      return null;
    }

    const result = {} as Record<NumericSummaryField, number>;
    for (const field of NUMERIC_SUMMARY_FIELDS) {
      const descriptor = Object.getOwnPropertyDescriptor(value, field);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        return null;
      }
      const fieldValue: unknown = descriptor.value;
      if (typeof fieldValue !== "number" || !Number.isFinite(fieldValue)) {
        return null;
      }
      result[field] = fieldValue;
    }

    const within = (field: NumericSummaryField, min: number, max: number) =>
      result[field] >= min && result[field] <= max;

    if (!Number.isInteger(result.rep_count) || !within("rep_count", 1, 20)) {
      return null;
    }
    if (SCORE_FIELDS.some((field) => !within(field, 0, 100))) return null;
    if (ANGLE_FIELDS.some((field) => !within(field, 0, 180))) return null;
    if (!within("max_shrug", 0, 1)) return null;
    if (
      !within("concentric_ms_average", 1, 15_000) ||
      !within("top_pause_ms_average", 0, 15_000) ||
      !within("eccentric_ms_average", 1, 15_000)
    ) {
      return null;
    }
    if (
      result.minimum_score > result.average_score ||
      result.average_score > result.maximum_score ||
      result.rom_min_angle_average >= result.rom_max_angle_average
    ) {
      return null;
    }
    if (
      FAULT_COUNT_FIELDS.some(
        (field) =>
          !Number.isInteger(result[field]) ||
          !within(field, 0, result.rep_count),
      )
    ) {
      return null;
    }

    // Rebuild from the fixed field list; never forward the caller's object.
    return Object.fromEntries(
      NUMERIC_SUMMARY_FIELDS.map((field) => [field, result[field]]),
    ) as NumericAttemptSummary;
  } catch {
    // Proxies and accessor traps are rejected as malformed input.
    return null;
  }
}

function readConfig(env: SummaryEnvironment): SummaryConfig | null {
  if (env.FORM_COACH_LLM_PROVIDER !== "openai") return null;
  const model = env.FORM_COACH_LLM_MODEL?.trim();
  const apiKey = env.FORM_COACH_LLM_API_KEY?.trim();
  if (
    !model ||
    model.length > 100 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(model) ||
    !apiKey
  ) {
    return null;
  }
  return { model, apiKey };
}

function errorName(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const name = (value as { name?: unknown }).name;
  return typeof name === "string" ? name : undefined;
}

function errorStatusCode(value: unknown): number | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const statusCode = (value as { statusCode?: unknown }).statusCode;
  return typeof statusCode === "number" && Number.isInteger(statusCode)
    ? statusCode
    : undefined;
}

function isTimeoutError(value: unknown): boolean {
  let current: unknown = value;
  for (let depth = 0; depth < 3 && current !== undefined; depth += 1) {
    const name = errorName(current);
    if (name === "TimeoutError" || name === "AbortError") return true;
    if (current === null || typeof current !== "object") return false;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function classifyProviderError(error: unknown): FormCoachSummaryResult {
  if (isTimeoutError(error)) {
    return { status: "retryable", category: "timeout" };
  }

  const statusCode = errorStatusCode(error);
  if (statusCode === 408) return { status: "retryable", category: "timeout" };
  if (statusCode === 429) {
    return { status: "retryable", category: "rate_limited" };
  }
  if (statusCode === 409 || (statusCode !== undefined && statusCode >= 500)) {
    return { status: "retryable", category: "provider_unavailable" };
  }
  if (statusCode === 401 || statusCode === 403) {
    return { status: "unavailable", category: "provider_auth" };
  }
  if (statusCode !== undefined) {
    return { status: "unavailable", category: "provider_rejected" };
  }
  if (
    APICallError.isInstance(error) &&
    error.statusCode === undefined &&
    error.isRetryable
  ) {
    return { status: "retryable", category: "network" };
  }
  return { status: "unavailable", category: "provider_error" };
}

function validateGeneratedText(text: string): string | null {
  const normalized = text.trim();
  if (!normalized) return null;
  if (
    normalized.length > 1_000 ||
    /[<>]/.test(normalized) ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(normalized)
  ) {
    return null;
  }
  const sentences = normalized.match(/[.!?](?:["')\]]*)?(?=\s|$)/g) ?? [];
  if (sentences.length < 2 || sentences.length > 4) return null;
  return normalized;
}

export function createFormCoachSummaryProvider(options: ProviderOptions = {}) {
  const env: SummaryEnvironment = options.env ?? {
    FORM_COACH_LLM_PROVIDER: process.env.FORM_COACH_LLM_PROVIDER,
    FORM_COACH_LLM_MODEL: process.env.FORM_COACH_LLM_MODEL,
    FORM_COACH_LLM_API_KEY: process.env.FORM_COACH_LLM_API_KEY,
  };
  const fetchImpl = options.fetchImpl ?? fetch;
  const monotonicNow = options.monotonicNow ?? (() => performance.now());

  return {
    isConfigured(): boolean {
      return readConfig(env) !== null;
    },

    async summarize(
      input: unknown,
      requestOptions: FormCoachSummaryRequestOptions = {},
    ): Promise<FormCoachSummaryResult> {
      const numericSummary = normalizeNumericSummary(input);
      if (!numericSummary) return { status: "invalid_input" };

      const config = readConfig(env);
      if (!config) return { status: "unconfigured" };

      if (requestOptions.signal?.aborted) {
        return { status: "retryable", category: "timeout" };
      }

      const startedAt = monotonicNow();
      const requestedTimeout = requestOptions.timeoutMs ?? FORM_COACH_SUMMARY_TIMEOUT_MS;
      const deadlineAtMonotonic = Math.min(
        requestOptions.deadlineAtMonotonic ??
          startedAt + FORM_COACH_SUMMARY_TIMEOUT_MS,
        startedAt + FORM_COACH_SUMMARY_TIMEOUT_MS,
      );
      const timeoutMs = Math.floor(
        Math.min(requestedTimeout, deadlineAtMonotonic - startedAt),
      );
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        return { status: "retryable", category: "timeout" };
      }

      const guardedFetch: typeof fetch = async (input, init) => {
        if (requestOptions.signal?.aborted) {
          throw new DOMException("Summary deadline expired", "TimeoutError");
        }
        if (monotonicNow() >= deadlineAtMonotonic) {
          throw new DOMException("Summary deadline expired", "TimeoutError");
        }
        const transportSignal =
          init?.signal ?? (input instanceof Request ? input.signal : undefined);
        if (transportSignal?.aborted) {
          throw new DOMException("Summary deadline expired", "TimeoutError");
        }
        return fetchImpl(input, init);
      };

      try {
        const openai = createOpenAI({
          apiKey: config.apiKey,
          baseURL: OPENAI_BASE_URL,
          fetch: guardedFetch,
        });
        const generated = await generateText({
          model: openai.responses(config.model),
          system: FORM_COACH_SUMMARY_SYSTEM_PROMPT,
          prompt: buildFormCoachSummaryPrompt(JSON.stringify(numericSummary)),
          providerOptions: {
            openai: {
              reasoningEffort: "none",
              store: false,
            },
          },
          maxOutputTokens: FORM_COACH_SUMMARY_MAX_OUTPUT_TOKENS,
          maxRetries: 0,
          abortSignal: requestOptions.signal,
          timeout: timeoutMs,
          telemetry: {
            isEnabled: false,
            recordInputs: false,
            recordOutputs: false,
          },
        });

        if (generated.finishReason === "content-filter") {
          return { status: "unavailable", category: "blocked" };
        }
        if (
          generated.finishReason === "length" ||
          generated.finishReason === "interrupted"
        ) {
          return { status: "unavailable", category: "truncated" };
        }
        if (generated.finishReason !== "stop") {
          return { status: "unavailable", category: "provider_error" };
        }

        const text = validateGeneratedText(generated.text);
        if (!text) {
          return {
            status: "unavailable",
            category: generated.text.trim() ? "invalid_output" : "empty_output",
          };
        }
        return {
          status: "ready",
          promptVersion: FORM_COACH_SUMMARY_PROMPT_VERSION,
          text,
        };
      } catch (error) {
        return classifyProviderError(error);
      }
    },
  };
}
