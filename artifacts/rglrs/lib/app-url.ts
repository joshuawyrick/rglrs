const DEFAULT_CANONICAL_ORIGIN = "https://therglrs.com";

function validatedOrigin(value: string | undefined) {
  if (!value) return DEFAULT_CANONICAL_ORIGIN;
  try {
    const url = new URL(value);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      return DEFAULT_CANONICAL_ORIGIN;
    }
    return url.origin;
  } catch {
    return DEFAULT_CANONICAL_ORIGIN;
  }
}

export const canonicalOrigin = validatedOrigin(process.env.NEXT_PUBLIC_APP_URL);

export function safeRelativePath(value: string | null | undefined, fallback = "/") {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value) || /%(?:0[0-9a-f]|1[0-9a-f]|5c|7f)/i.test(value)) return fallback;
  try {
    const parsed = new URL(value, DEFAULT_CANONICAL_ORIGIN);
    if (parsed.origin !== DEFAULT_CANONICAL_ORIGIN) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function getAppPath(path: string) {
  return safeRelativePath(path.startsWith("/") ? path : `/${path}`);
}

/** Absolute URL for email, sharing, metadata, and QR surfaces. */
export function getAppUrl(path: string) {
  return new URL(getAppPath(path), `${canonicalOrigin}/`).toString();
}