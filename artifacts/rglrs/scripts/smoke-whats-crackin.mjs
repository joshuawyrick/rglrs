import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const baseUrl = process.env.SMOKE_BASE_URL;
const browserKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim();
const placesKey = process.env.GOOGLE_PLACES_API_KEY?.trim();
const smokeReferrer = process.env.RELEASE_SMOKE_REFERRER || process.env.NEXT_PUBLIC_APP_URL || baseUrl;
const stubMaps = process.env.RELEASE_MAP_SMOKE_STUB === "1";

if (!baseUrl) throw new Error("Set SMOKE_BASE_URL before running the What's Crackin browser smoke test.");
if (!browserKey) throw new Error("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is required for the What's Crackin browser smoke test.");
if (!stubMaps && !smokeReferrer) throw new Error("Set RELEASE_SMOKE_REFERRER or NEXT_PUBLIC_APP_URL for the live Maps referrer smoke check.");

const expectedReferrer = smokeReferrer ? `${new URL(smokeReferrer).origin}/` : null;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const configuredEmail = process.env.RELEASE_SMOKE_EMAIL?.trim();
const configuredPassword = process.env.RELEASE_SMOKE_PASSWORD;
const failures = [];

function recordFailure(message) {
  failures.push(message);
}

async function createSmokeUser() {
  if (configuredEmail && configuredPassword) return { email: configuredEmail, password: configuredPassword, cleanup: null };
  if (!supabaseUrl || !process.env.SUPABASE_SECRET_KEY) {
    throw new Error("Set RELEASE_SMOKE_EMAIL/RELEASE_SMOKE_PASSWORD or provide SUPABASE_SECRET_KEY to provision the browser smoke account.");
  }

  const admin = createClient(supabaseUrl, process.env.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const email = `release-smoke-${suffix}@example.com`;
  const password = `RglrsSmoke-${suffix}-9!`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`Could not provision the browser smoke account: ${error?.message || "unknown error"}`);
  return {
    email,
    password,
    cleanup: async () => {
      const { error: deleteError } = await admin.auth.admin.deleteUser(data.user.id);
      if (deleteError) throw new Error(`Could not clean up the browser smoke account: ${deleteError.message}`);
    },
  };
}

function assertNoServerKey(value, source) {
  if (value.includes("GOOGLE_PLACES_API_KEY")) recordFailure(`${source} contains the server-only GOOGLE_PLACES_API_KEY name.`);
  if (placesKey && value.includes(placesKey)) recordFailure(`${source} contains the server-only Places API key.`);
}

const account = await createSmokeUser();
let browser;
try {
  assert(supabaseUrl && supabaseKey, "Supabase public configuration is required for authenticated browser smoke.");
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.RELEASE_SMOKE_BROWSER_PATH ||
      process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
      undefined,
  });
  const context = await browser.newContext({
    geolocation: { latitude: 36.1699, longitude: -115.1398 },
    permissions: ["geolocation"],
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const mapRequests = [];
  const mapReferrers = [];
  const requestUrls = [];
  const bundleBodies = [];
  const googleConsoleErrors = [];
  let mapAttempts = 0;
  let mapsUnavailable = false;

  page.on("request", (request) => requestUrls.push(request.url()));
  page.on("console", (message) => {
    if (/Google Maps JavaScript API error/i.test(message.text())) {
      googleConsoleErrors.push(message.text());
    }
  });
  page.on("response", (response) => {
    const contentType = response.headers()["content-type"] || "";
    if (contentType.includes("javascript") && new URL(response.url()).origin === new URL(baseUrl).origin) {
      bundleBodies.push(response.text().catch(() => ""));
    }
  });
  await context.route("https://maps.googleapis.com/maps/api/js**", async (route) => {
    const request = route.request();
    mapAttempts += 1;
    mapRequests.push(request);
    const headers = { ...request.headers(), referer: expectedReferrer };
    mapReferrers.push(headers.referer);
    if (mapsUnavailable || mapAttempts === 1) {
      await route.abort("failed");
      return;
    }
    if (stubMaps) {
      await route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: `
          (() => {
            class TestMap {
              constructor(node, options = {}) {
                this.node = node;
                this.center = options.center || null;
                this.zoom = options.zoom || 0;
                this.pan = { x: 0, y: 0 };
                node.dataset.testMap = "ready";
                const surface = document.createElement("div");
                surface.dataset.testid = "deterministic-map-surface";
                surface.setAttribute("aria-label", "Deterministic test map");
                surface.style.cssText = "position:absolute;inset:0;background:linear-gradient(135deg,#142126,#20343a);";
                node.appendChild(surface);
                window.__rglrsTestMap = this;
              }
              setCenter(center) { this.center = center; }
              getCenter() { return this.center; }
              setZoom(zoom) { this.zoom = zoom; this.node.dataset.testZoom = String(zoom); }
              getZoom() { return this.zoom; }
              panBy(x, y) {
                this.pan = { x: this.pan.x + x, y: this.pan.y + y };
                this.node.dataset.testPan = this.pan.x + "," + this.pan.y;
              }
            }
            class TestMarker {
              constructor(options = {}) { this.map = options.map || null; }
              setMap(map) { this.map = map; }
              addListener() { return { remove() {} }; }
            }
            window.google = { maps: {
              Map: TestMap,
              Marker: TestMarker,
              Size: class {},
              Point: class {},
              SymbolPath: { CIRCLE: "circle" }
            }};
          })();
        `,
        headers: { "access-control-allow-origin": "*" },
      });
      return;
    }
    await route.continue({ headers });
  });

  await page.goto(new URL("/whats-crackin", baseUrl).toString(), { waitUntil: "domcontentloaded" });
  if (new URL(page.url()).pathname === "/login") {
    await page.locator("#login-email").fill(account.email);
    await page.locator("#login-password").fill(account.password);
    await page.getByRole("button", { name: "Sign In" }).click();
    await page.waitForURL((url) => url.pathname === "/whats-crackin", { timeout: 30_000 });
  }

  await page.getByRole("heading", { name: "What’s Crackin" }).waitFor();
  await page.waitForTimeout(1_000);
  if (mapAttempts === 1) {
    await page.getByRole("button", { name: "Near You" }).click();
    await page.getByRole("button", { name: "Map", exact: true }).click();
  }
  await page.locator('[data-map-status="ready"]').waitFor({ timeout: 30_000 });
  if (mapAttempts < 2) recordFailure(`Expected the Maps script to retry after the forced failure, observed ${mapAttempts} attempt.`);

  if (!mapRequests[1] || (!stubMaps && mapReferrers[1] !== expectedReferrer)) {
    recordFailure(`Maps request did not use the approved referrer origin (${expectedReferrer}).`);
  }
  if (stubMaps) {
    await page.locator('[data-testid="deterministic-map-surface"]').waitFor();
    const interaction = await page.evaluate(() => {
      const map = window.__rglrsTestMap;
      if (!map) return null;
      const before = map.getZoom();
      map.setZoom(before + 1);
      map.panBy(48, -24);
      return {
        before,
        after: map.getZoom(),
        pan: map.pan,
      };
    });
    if (!interaction || interaction.after !== interaction.before + 1 || interaction.pan?.x !== 48 || interaction.pan?.y !== -24) {
      recordFailure("Deterministic Maps stub did not support zoom and pan interactions.");
    }
  }
  if (mapRequests.some((request) => request.url().includes(placesKey || "never-match"))) {
    recordFailure("A browser-visible Maps request contains the server-only Places API key.");
  }

  await page.getByRole("button", { name: "Share my location" }).click();
  await page.getByText("Sharing location", { exact: true }).waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByText("Location sharing stopped. Your pin was removed immediately.", { exact: true }).waitFor({ timeout: 30_000 });

  mapsUnavailable = true;
  await page.evaluate(() => {
    delete window.google;
    window.__rglrsGoogleMapsPromise = undefined;
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "What’s Crackin" }).waitFor();
  await page.locator('[data-map-status="error"]').waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "Near You" }).click();
  await page.locator('[data-testid="near-you-list"]').waitFor();
  if (await page.locator('[data-testid="near-you-list"]').isHidden()) recordFailure("Near You is hidden while Maps is unavailable.");

  assertNoServerKey(await page.content(), "What's Crackin page HTML");
  for (const url of requestUrls) assertNoServerKey(url, "browser request URL");
  for (const body of await Promise.all(bundleBodies)) assertNoServerKey(body, "browser JavaScript bundle");
  if (googleConsoleErrors.length) recordFailure(`Google Maps reported an API error: ${googleConsoleErrors[0]}`);
} finally {
  if (browser) await browser.close();
  if (account.cleanup) await account.cleanup();
}

if (failures.length) {
  console.error("What's Crackin browser smoke checks failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`What's Crackin browser smoke checks passed (${stubMaps ? "deterministic Maps stub" : "live Maps"}, retry, simulated failure fallback, geolocation start/stop, Near You isolation, and server-key exposure assertions).`);