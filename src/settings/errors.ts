import { LlmError } from "../llm/api";

export function llmErrorCopy(err: unknown): string {
  const { code, message } = normalizeLlmError(err);
  if (code === "unreachable") {
    return "Could not reach the API. Check the base URL and that the server is running.";
  }
  if (code === "invalid_key") {
    return message || "The API key was rejected. Check the key and try again.";
  }
  if (code === "rate_limited") {
    return "The API rate limit was hit. Wait a moment and try again.";
  }
  return message || "Could not talk to the API";
}

function normalizeLlmError(err: unknown): {
  code: string | null;
  message: string;
} {
  if (err instanceof LlmError) {
    const prefix = `${err.code}: `;
    const message = err.message.startsWith(prefix)
      ? err.message.slice(prefix.length)
      : err.message;
    return { code: err.code, message };
  }
  if (err !== null && typeof err === "object" && "code" in err) {
    const code = typeof err.code === "string" ? err.code : null;
    const message =
      "message" in err && typeof err.message === "string" ? err.message : "";
    return { code, message };
  }
  if (err instanceof Error) {
    return { code: null, message: err.message };
  }
  return { code: null, message: "" };
}
