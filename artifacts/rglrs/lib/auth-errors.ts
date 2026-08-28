const EMAIL_RATE_LIMIT_MESSAGE =
  "Email delivery is temporarily rate-limited. Please wait a few minutes before trying again. If this continues in production, configure a custom email provider.";

function errorMessage(error: unknown) {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message.trim();
  }
  return "";
}

export function isEmailRateLimitError(error: unknown) {
  const message = errorMessage(error).toLowerCase();
  return (
    message.includes("rate limit") ||
    message.includes("rate_limit") ||
    message.includes("too many requests") ||
    message.includes("security purposes") ||
    (message.includes("email") && message.includes("limit"))
  );
}

export function formatAuthError(error: unknown, fallback: string) {
  if (isEmailRateLimitError(error)) return EMAIL_RATE_LIMIT_MESSAGE;
  return errorMessage(error) || fallback;
}