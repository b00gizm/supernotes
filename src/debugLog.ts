/** Debug-mode NDJSON logger (vitest/node only). */
export function debugLog(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown>,
): void {
  try {
    // Dynamic require so Vite browser builds do not resolve node:fs.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { appendFileSync } = require("node:fs") as typeof import("node:fs");
    appendFileSync(
      "/opt/cursor/logs/debug.log",
      `${JSON.stringify({ hypothesisId, location, message, data, timestamp: Date.now() })}\n`,
    );
  } catch {
    /* browser / non-node */
  }
}
