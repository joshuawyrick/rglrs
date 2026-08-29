const baseUrl = process.env.SMOKE_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;

if (!baseUrl) {
  console.error("Set SMOKE_BASE_URL or NEXT_PUBLIC_APP_URL before running route smoke tests.");
  process.exit(1);
}

const publicRoutes = [
  "/welcome",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/service-unavailable",
  "/manifest.webmanifest",
];
const protectedRoutes = [
  "/",
  "/create",
  "/create/audience",
  "/events",
  "/events/vegas-2026",
  "/events/vegas-2026/gallery",
  "/events/emma-birthday/invite",
  "/invite/accepted",
  "/messages",
  "/messages/besties",
  "/profile",
  "/saved",
  "/notifications",
  "/settings",
  "/settings/account",
  "/settings/security",
  "/settings/data",
  "/settings/blocked",
  "/search",
  "/people/00000000-0000-0000-0000-000000000000",
  "/events/new",
  "/events/vegas-2026/members",
  "/post/p1",
  "/install",
  "/whats-crackin",
];
const protectedApiRoutes = [
  "/account-data/export",
  "/account-data",
];

const failures = [];
const requiredSecurityHeaders = {
  "content-security-policy": ["default-src 'self'", "frame-ancestors 'none'", "object-src 'none'"],
  "referrer-policy": ["strict-origin-when-cross-origin"],
  "permissions-policy": ["camera=()", "microphone=()", "geolocation=(self)"],
  "x-content-type-options": ["nosniff"],
  "x-frame-options": ["DENY"],
};

function assertSecurityHeaders(route, response) {
  for (const [header, expectedValues] of Object.entries(requiredSecurityHeaders)) {
    const actual = response.headers.get(header) || "";
    for (const expected of expectedValues) {
      if (!actual.includes(expected)) {
        failures.push(`${route}: ${header} is missing ${JSON.stringify(expected)}`);
      }
    }
  }
  if (new URL(baseUrl).protocol === "https:" && !response.headers.has("strict-transport-security")) {
    failures.push(`${route}: HTTPS response is missing strict-transport-security`);
  }
}

for (const route of publicRoutes) {
  try {
    const response = await fetch(new URL(route, baseUrl), {
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      failures.push(`${route}: expected 2xx, received ${response.status}`);
    }
    if (route === "/welcome") assertSecurityHeaders(route, response);
  } catch (error) {
    failures.push(`${route}: request failed (${error instanceof Error ? error.message : "unknown error"})`);
  }
}

for (const route of protectedRoutes) {
  try {
    const response = await fetch(new URL(route, baseUrl), {
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    const location = response.headers.get("location");
    const isLoginRedirect =
      [302, 303, 307, 308].includes(response.status) &&
      location &&
      new URL(location, baseUrl).pathname === "/login";
    if (!isLoginRedirect) {
      failures.push(
        `${route}: expected an unauthenticated login redirect, received ${response.status}`,
      );
    }
    assertSecurityHeaders(route, response);
  } catch (error) {
    failures.push(
      `${route}: request failed (${error instanceof Error ? error.message : "unknown error"})`,
    );
  }
}

for (const route of protectedApiRoutes) {
  try {
    const response = await fetch(new URL(route, baseUrl), {
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status !== 401 || response.headers.get("content-type")?.includes("application/json") !== true) {
      failures.push(`${route}: expected an unauthenticated JSON 401, received ${response.status}`);
    }
    if (!/\bno-store\b/i.test(response.headers.get("cache-control") || "")) {
      failures.push(`${route}: protected API response must set Cache-Control: no-store`);
    }
  } catch (error) {
    failures.push(
      `${route}: request failed (${error instanceof Error ? error.message : "unknown error"})`,
    );
  }
}

try {
  const response = await fetch(new URL("/sw.js", baseUrl), {
    signal: AbortSignal.timeout(30_000),
  });
  const source = await response.text();
  if (!response.ok) failures.push(`/sw.js: expected 2xx, received ${response.status}`);
  if (!/\bno-store\b/i.test(response.headers.get("cache-control") || "")) {
    failures.push("/sw.js: service worker must not be served from a persistent cache");
  }
  if (!source.includes('/_next/static/')) {
    failures.push("/sw.js: service worker does not restrict caching to immutable Next static assets");
  }
  for (const forbidden of ["caches.match(\"/\")", '"/events"', '"/messages"', '"/profile"']) {
    if (source.includes(forbidden)) {
      failures.push(`/sw.js: service worker contains forbidden private/HTML cache target ${forbidden}`);
    }
  }
} catch (error) {
  failures.push(`/sw.js: request failed (${error instanceof Error ? error.message : "unknown error"})`);
}

if (failures.length) {
  console.error("Route smoke checks failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(
  `Route smoke checks passed (${publicRoutes.length + protectedRoutes.length + protectedApiRoutes.length} routes plus security/PWA assertions).`,
);