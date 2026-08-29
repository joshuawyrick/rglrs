import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const baseUrl = process.env.SMOKE_BASE_URL;
const browserKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim();
const placesKey = process.env.GOOGLE_PLACES_API_KEY?.trim();
const documentedDevelopmentReferrer =
  "https://59204ef6-03f6-42fe-8123-2c15b21d523d-00-1efpiyhwk7lgs-rbodksnm.picard.replit.dev/";
const approvedDevelopmentReferrer = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN.trim()}/`
  : documentedDevelopmentReferrer;
const stubMaps = process.env.RELEASE_MAP_SMOKE_STUB === "1";

if (!baseUrl) throw new Error("Set SMOKE_BASE_URL before running the What's Crackin browser smoke test.");
if (!browserKey) throw new Error(`${stubMaps ? "A deterministic test Maps key" : "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY"} is required for the What's Crackin browser smoke test.`);
const baseOrigin = new URL(baseUrl).origin;
const isLocalSmokeTarget = ["localhost", "127.0.0.1", "::1"].includes(new URL(baseUrl).hostname);
const smokeReferrer =
  process.env.RELEASE_SMOKE_REFERRER?.trim() ||
  (isLocalSmokeTarget ? approvedDevelopmentReferrer : baseOrigin);

const expectedReferrer = `${new URL(smokeReferrer).origin}/`;
const browserBaseUrl = isLocalSmokeTarget ? expectedReferrer : baseUrl;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const configuredEmail = process.env.RELEASE_SMOKE_EMAIL?.trim();
const configuredPassword = process.env.RELEASE_SMOKE_PASSWORD;
const failures = [];

function recordFailure(message) {
  failures.push(message);
}

if (placesKey && browserKey === placesKey) {
  throw new Error("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY and GOOGLE_PLACES_API_KEY must be distinct.");
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
  await context.addInitScript(() => {
    const geo = navigator.geolocation;
    if (!geo) return;
    const state = { nextId: 41, started: [], cleared: [] };
    Object.defineProperty(window, "__rglrsGeoTest", { value: state, configurable: true });
    Object.defineProperty(geo, "watchPosition", {
      configurable: true,
      value(success) {
        const id = state.nextId++;
        state.started.push(id);
        queueMicrotask(() => success({
          coords: {
            latitude: 36.1699,
            longitude: -115.1398,
            accuracy: 12,
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
          },
          timestamp: Date.now(),
        }));
        return id;
      },
    });
    Object.defineProperty(geo, "clearWatch", {
      configurable: true,
      value(id) {
        state.cleared.push(id);
      },
    });
  });
  if (isLocalSmokeTarget) {
    await context.route(`${new URL(browserBaseUrl).origin}/**`, async (route) => {
      const request = route.request();
      const requestUrl = new URL(request.url());
      const localUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, baseUrl);
      const forwardedHeaders = await request.allHeaders();
      const response = await fetch(localUrl, {
        method: request.method(),
        headers: forwardedHeaders,
        body: ["GET", "HEAD"].includes(request.method()) ? undefined : request.postDataBuffer(),
        redirect: "manual",
      });
      const headers = Object.fromEntries(response.headers);
      if (headers.location) {
        const redirectUrl = new URL(headers.location, baseUrl);
        if (redirectUrl.origin === baseOrigin) {
          headers.location = new URL(
            `${redirectUrl.pathname}${redirectUrl.search}${redirectUrl.hash}`,
            browserBaseUrl,
          ).toString();
        }
      }
      await route.fulfill({
        status: response.status,
        headers,
        body: Buffer.from(await response.arrayBuffer()),
      });
    });
  }
  const page = await context.newPage();
  const mapRequests = [];
  const mapReferrers = [];
  const requestUrls = [];
  const bundleBodies = [];
  const googleConsoleErrors = [];
  let mapAttempts = 0;
  let continuedMapRequests = 0;
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
                let dragStart = null;
                surface.addEventListener("pointerdown", (event) => {
                  dragStart = { x: event.clientX, y: event.clientY };
                  surface.setPointerCapture?.(event.pointerId);
                });
                surface.addEventListener("pointerup", (event) => {
                  if (!dragStart) return;
                  this.panBy(event.clientX - dragStart.x, event.clientY - dragStart.y);
                  dragStart = null;
                });
                node.appendChild(surface);
                const zoomIn = document.createElement("button");
                zoomIn.type = "button";
                zoomIn.dataset.testid = "deterministic-map-zoom-in";
                zoomIn.setAttribute("aria-label", "Zoom in");
                zoomIn.textContent = "+";
                zoomIn.style.cssText = "position:absolute;right:8px;top:8px;z-index:1;width:32px;height:32px;";
                zoomIn.addEventListener("click", () => this.setZoom(this.zoom + 1));
                node.appendChild(zoomIn);
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
    const headers = { ...request.headers(), referer: expectedReferrer };
    mapReferrers.push(headers.referer);
    continuedMapRequests += 1;
    await route.continue({ headers });
  });

  const postLoginPath = isLocalSmokeTarget ? "/install" : "/whats-crackin";
  const loginBaseUrl = isLocalSmokeTarget ? baseUrl : browserBaseUrl;
  await page.goto(
    new URL(`/login?next=${encodeURIComponent(postLoginPath)}`, loginBaseUrl).toString(),
    {
    waitUntil: "domcontentloaded",
    },
  );
  await page.locator("#login-email").fill(account.email);
  await page.locator("#login-password").fill(account.password);
  await page.getByRole("button", { name: "Sign In" }).click();
  try {
    await page.waitForURL((url) => url.pathname === postLoginPath, { timeout: 30_000 });
  } catch (error) {
    throw new Error(`Authenticated smoke navigation stopped at ${new URL(page.url()).pathname}.`, {
      cause: error,
    });
  }
  if (isLocalSmokeTarget) {
    const localCookies = await context.cookies(baseUrl);
    await context.addCookies(
      localCookies.map(({ name, value, expires, httpOnly, sameSite }) => ({
        name,
        value,
        url: browserBaseUrl,
        expires,
        httpOnly,
        secure: true,
        sameSite,
      })),
    );
    await page.goto(new URL("/whats-crackin", browserBaseUrl).toString(), {
      waitUntil: "domcontentloaded",
    });
  }

  await page.getByRole("heading", { name: "What’s Crackin" }).waitFor();
  await page.waitForTimeout(1_000);
  if (mapAttempts === 1) {
    await page.getByRole("button", { name: "Near You" }).click();
    await page.getByRole("button", { name: "Map", exact: true }).click();
  }
  await page.locator('[data-map-status="ready"]').waitFor({ timeout: 30_000 });
  if (mapAttempts < 2) recordFailure(`Expected the Maps script to retry after the forced failure, observed ${mapAttempts} attempt.`);
  if ((await page.viewportSize())?.width !== 390) recordFailure("Authenticated Maps smoke did not run at the required 390px mobile width.");

  if (!stubMaps) {
    const mapViewport = page.locator('[data-map-status="ready"] .gm-style').first();
    await mapViewport.waitFor({ state: "visible" });
    const mapBox = await mapViewport.boundingBox();
    if (!mapBox || mapBox.width > 390) recordFailure("Google Maps did not fit the 390px mobile viewport.");

    const zoomIn = page.locator('button[aria-label="Zoom in"]').first();
    await zoomIn.waitFor({ state: "visible" });
    await zoomIn.click();
    if (mapBox) {
      await page.mouse.move(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(mapBox.x + mapBox.width / 2 + 48, mapBox.y + mapBox.height / 2 + 24, { steps: 6 });
      await page.mouse.up();
    }
    await page.locator('[data-map-status="ready"]').waitFor();
  }

  if (!mapRequests[1] || (!stubMaps && mapReferrers[1] !== expectedReferrer)) {
    recordFailure(`Maps request did not use the approved referrer origin (${expectedReferrer}).`);
  }
  if (stubMaps) {
    if (continuedMapRequests !== 0) recordFailure("Stub mode allowed a Google Maps request to continue to the network.");
    if (new URL(mapRequests[1].url()).searchParams.get("key") !== browserKey) {
      recordFailure("Deterministic Maps request did not use the release gate's test-only key.");
    }
    await page.locator('[data-testid="deterministic-map-surface"]').waitFor();
    const before = await page.evaluate(() => {
      const map = window.__rglrsTestMap;
      return map ? { zoom: map.getZoom(), pan: map.pan } : null;
    });
    await page.locator('[data-testid="deterministic-map-zoom-in"]').click();
    const surface = page.locator('[data-testid="deterministic-map-surface"]');
    const box = await surface.boundingBox();
    if (!box) {
      recordFailure("Deterministic Maps surface was not visible for pan interaction.");
    } else {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 48, box.y + box.height / 2 - 24, { steps: 4 });
      await page.mouse.up();
    }
    const after = await page.evaluate(() => {
      const map = window.__rglrsTestMap;
      return map ? { zoom: map.getZoom(), pan: map.pan } : null;
    });
    if (!before || !after || after.zoom !== before.zoom + 1 || after.pan?.x !== 48 || after.pan?.y !== -24) {
      recordFailure("Deterministic Maps stub did not support zoom and pan interactions.");
    }
  }
  if (mapRequests.some((request) => request.url().includes(placesKey || "never-match"))) {
    recordFailure("A browser-visible Maps request contains the server-only Places API key.");
  }

  await page.getByRole("button", { name: "Share my location" }).click();
  await page.getByText("Sharing location", { exact: true }).waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => window.__rglrsGeoTest?.started.length === 1);
  const startedWatch = await page.evaluate(() => window.__rglrsGeoTest?.started[0]);
  if (typeof startedWatch !== "number") recordFailure("Foreground sharing did not start a geolocation watch.");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByText("Location sharing stopped. Your pin was removed immediately.", { exact: true }).waitFor({ timeout: 30_000 });
  await page.waitForFunction((watchId) => window.__rglrsGeoTest?.cleared.includes(watchId), startedWatch);
  const clearedWatches = await page.evaluate(() => window.__rglrsGeoTest?.cleared || []);
  if (!clearedWatches.includes(startedWatch)) recordFailure("Stop Sharing did not clear the active geolocation watch.");

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
console.log(`What's Crackin browser smoke checks passed (${stubMaps ? "deterministic Maps stub" : "live Maps at 390px with zoom/pan"}, retry, simulated failure fallback, geolocation start/stop, Near You isolation, referrer, and server-key exposure assertions).`);
