import "server-only";

type UnknownRecord = Record<string, unknown>;

export type OpenAITelemetry = {
  event: "openai.response" | "openai.error";
  requestedModel: string;
  actualModel: string | null;
  status: string;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
  incompleteReason: string | null;
  errorClassification: string | null;
  providerCode: string | null;
  requestId: string | null;
  responseId: string | null;
};

function record(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null
    ? value as UnknownRecord
    : null;
}

function safeIdentifier(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value)
    ? value
    : null;
}

function safeCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function classifyError(status: number | null, name: string | null): string {
  if (status === 401 || status === 403) return "authentication";
  if (status === 429) return "rate_limit";
  if (status === 408 || name === "APIConnectionTimeoutError") return "timeout";
  if (status !== null && status >= 500) return "provider_server";
  if (status !== null && status >= 400) return "invalid_request";
  if (name === "APIConnectionError") return "connection";
  if (name === "APIUserAbortError") return "aborted";
  return "provider_error";
}

export function responseTelemetry(
  response: unknown,
  requestedModel: string,
): OpenAITelemetry {
  const value = record(response) ?? {};
  const usage = record(value.usage);
  const outputDetails = record(usage?.output_tokens_details);
  const incompleteDetails = record(value.incomplete_details);
  const responseError = record(value.error);

  return {
    event: "openai.response",
    requestedModel,
    actualModel: safeIdentifier(value.model),
    status: safeIdentifier(value.status) ?? "unknown",
    inputTokens: safeCount(usage?.input_tokens),
    outputTokens: safeCount(usage?.output_tokens),
    reasoningTokens: safeCount(outputDetails?.reasoning_tokens),
    totalTokens: safeCount(usage?.total_tokens),
    incompleteReason: safeIdentifier(incompleteDetails?.reason),
    errorClassification: responseError ? "provider_response_error" : null,
    providerCode: safeIdentifier(responseError?.code),
    requestId: safeIdentifier(value._request_id),
    responseId: safeIdentifier(value.id),
  };
}

export function errorTelemetry(
  error: unknown,
  requestedModel: string,
): OpenAITelemetry {
  const value = record(error) ?? {};
  const status = typeof value.status === "number" && Number.isInteger(value.status)
    ? value.status
    : null;
  const name = safeIdentifier(value.name);

  return {
    event: "openai.error",
    requestedModel,
    actualModel: null,
    status: status === null ? "request_failed" : `http_${status}`,
    inputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    totalTokens: null,
    incompleteReason: null,
    errorClassification: classifyError(status, name),
    providerCode: safeIdentifier(value.code),
    requestId: safeIdentifier(value.requestID) ?? safeIdentifier(value.request_id),
    responseId: null,
  };
}
