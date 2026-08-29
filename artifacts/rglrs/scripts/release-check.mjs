import { readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const releasePort = process.env.RELEASE_CHECK_PORT || "34568";
const releaseBaseUrl = `http://127.0.0.1:${releasePort}`;
const releaseDistDir = `.next-release-${process.pid}`;
const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
const generatedConfigFiles = ["next-env.d.ts", "tsconfig.json"];
const generatedConfigSnapshots = new Map(
  await Promise.all(
    generatedConfigFiles.map(async (fileName) => [fileName, await readFile(fileName, "utf8")]),
  ),
);
const releaseEnvironment = {
  ...process.env,
  NODE_ENV: "production",
  PORT: releasePort,
  RGLRS_DIST_DIR: releaseDistDir,
};

function run(command, args, environment = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: environment,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(" ")} failed with ${signal ? `signal ${signal}` : `exit ${code}`}`,
        ),
      );
    });
  });
}

async function waitForServer(server) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`Production smoke server exited early with code ${server.exitCode}.`);
    }
    try {
      const response = await fetch(`${releaseBaseUrl}/welcome`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) return;
    } catch {
      // The server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Production smoke server did not become ready within 30 seconds.");
}

async function stopServer(server) {
  if (server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (server.exitCode === null) server.kill("SIGKILL");
}

let server;

try {
  await rm(releaseDistDir, { recursive: true, force: true });
  await run("pnpm", ["run", "typecheck"]);
  await run("pnpm", ["run", "build"], releaseEnvironment);
  await run("pnpm", ["run", "migrations:check"]);
  await run("pnpm", ["run", "privacy:test"]);
  await run(process.execPath, ["scripts/test-event-audience-selection.mjs"]);
  await run(process.execPath, ["scripts/test-bounded-upload-stream.mjs"]);
  await run(process.execPath, ["scripts/test-r2-immutable-promotion.mjs"]);
  await run(process.execPath, ["scripts/test-private-media-response.mjs"]);
  await run(process.execPath, ["scripts/test-invitation-contract.mjs"]);

  server = spawn(process.execPath, [nextBin, "start", "--hostname", "0.0.0.0", "--port", releasePort], {
    env: releaseEnvironment,
    stdio: "inherit",
  });
  await waitForServer(server);
  await run(
    "pnpm",
    ["run", "smoke"],
    { ...releaseEnvironment, SMOKE_BASE_URL: releaseBaseUrl },
  );
  await run(
    process.execPath,
    ["scripts/smoke-whats-crackin.mjs"],
    {
      ...releaseEnvironment,
      SMOKE_BASE_URL: releaseBaseUrl,
      RELEASE_MAP_SMOKE_STUB: "1",
    },
  );
  console.log("RGLRS release checks passed.");
} finally {
  if (server) await stopServer(server);
  await rm(releaseDistDir, { recursive: true, force: true });
  await Promise.all(
    [...generatedConfigSnapshots].map(([fileName, contents]) => writeFile(fileName, contents)),
  );
}