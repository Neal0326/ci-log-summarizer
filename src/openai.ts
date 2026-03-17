export type ConfidenceLevel = "low" | "medium" | "high";

export interface LogSummary {
  shortSummary: string;
  keyErrors: string[];
  failedStep: string;
  likelyCause: string;
  suggestedNextSteps: string[];
  confidenceLevel: ConfidenceLevel;
}

export interface SummarizeLogsOptions {
  apiKey: string;
  model: string;
  prompt: string;
}

interface OpenAIChatResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
    type?: string;
  };
}

export async function summarizeLogsWithOpenAI(
  options: SummarizeLogsOptions,
): Promise<LogSummary> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify({
      model: options.model,
      temperature: 0.1,
      response_format: {
        type: "json_object",
      },
      max_tokens: 450,
      messages: [
        {
          role: "system",
          content:
            "You are a senior DevOps engineer. Summarize GitHub Actions failure logs for developers. Focus on the first meaningful failure. Ignore noisy secondary warnings. Return strict JSON only with keys shortSummary, keyErrors, failedStep, likelyCause, suggestedNextSteps, confidenceLevel. shortSummary must be one short paragraph. keyErrors must be an array of the most important error lines or messages. failedStep must be the most likely failing step name. likelyCause must be a short explanation of what probably went wrong. suggestedNextSteps must be an array of actionable next steps. confidenceLevel must be one of low, medium, or high.",
        },
        {
          role: "user",
          content: options.prompt,
        },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });

  const rawPayload = await response.text();
  const payload = parseChatResponse(rawPayload);

  if (!response.ok) {
    throw new Error(
      `OpenAI API request failed: ${response.status} ${response.statusText}${
        payload.error?.message ? ` - ${payload.error.message}` : ""
      }`,
    );
  }

  const rawContent = payload.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw new Error("OpenAI response did not contain any message content.");
  }

  return normalizeSummary(parseSummary(rawContent));
}

function parseChatResponse(content: string): OpenAIChatResponse {
  try {
    return JSON.parse(content) as OpenAIChatResponse;
  } catch {
    throw new Error("OpenAI API response was not valid JSON.");
  }
}

function parseSummary(content: string): LogSummary {
  try {
    return JSON.parse(content) as LogSummary;
  } catch {
    const firstBrace = content.indexOf("{");
    const lastBrace = content.lastIndexOf("}");

    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      throw new Error("OpenAI response was not valid JSON.");
    }

    return JSON.parse(content.slice(firstBrace, lastBrace + 1)) as LogSummary;
  }
}

function normalizeSummary(summary: Partial<LogSummary>): LogSummary {
  const shortSummary =
    typeof summary.shortSummary === "string" ? summary.shortSummary.trim() : "";
  const failedStep =
    typeof summary.failedStep === "string" ? summary.failedStep.trim() : "";
  const likelyCause =
    typeof summary.likelyCause === "string" ? summary.likelyCause.trim() : "";
  const keyErrors = Array.isArray(summary.keyErrors)
    ? summary.keyErrors
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    : [];
  const suggestedNextSteps = Array.isArray(summary.suggestedNextSteps)
    ? summary.suggestedNextSteps
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    : [];

  if (!shortSummary || !failedStep || !likelyCause || suggestedNextSteps.length === 0) {
    throw new Error("OpenAI response JSON is missing required fields.");
  }

  return {
    shortSummary,
    keyErrors:
      keyErrors.length > 0
        ? keyErrors
        : ["No key error line was identified from the sanitized log excerpt."],
    failedStep,
    likelyCause,
    suggestedNextSteps,
    confidenceLevel: normalizeConfidenceLevel(summary.confidenceLevel),
  };
}

export function normalizeConfidenceLevel(value: unknown): ConfidenceLevel {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";

  if (normalized === "high" || normalized === "medium" || normalized === "low") {
    return normalized;
  }

  return "low";
}
