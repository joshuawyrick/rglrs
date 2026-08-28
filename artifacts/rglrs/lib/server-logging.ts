import { randomUUID } from "node:crypto";

type ErrorContext = Readonly<Record<string, string | number | boolean | null | undefined>>;

/**
 * Emits one structured, credential-free record for the deployment log drain.
 * Callers may return errorId to support without exposing exception details.
 */
export function logServerError(event: string, error: unknown, context: ErrorContext = {}) {
  const errorId = randomUUID();
  const exception =
    error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { name: "UnknownError", message: String(error) };

  console.error(JSON.stringify({
    level: "error",
    event,
    errorId,
    timestamp: new Date().toISOString(),
    ...context,
    exception,
  }));

  return errorId;
}