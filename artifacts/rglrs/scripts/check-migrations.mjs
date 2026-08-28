import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const artifactDirectory = path.resolve(scriptDirectory, "..");
const migrationsDirectory = path.join(artifactDirectory, "db/migrations");
const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
const projectRef = projectUrl?.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co/i)?.[1];

if (!projectRef || !accessToken) {
  console.error("Migration checks require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_ACCESS_TOKEN.");
  process.exit(1);
}

const files = (await readdir(migrationsDirectory))
  .filter((fileName) => /^\d{3}_[a-z0-9_]+\.sql$/.test(fileName))
  .sort();
const migrations = files.map((fileName) => ({
  fileName,
  version: Number(fileName.slice(0, 3)),
}));

if (!migrations.length) throw new Error("No numbered migrations were found.");
const expectedVersions = Array.from({ length: migrations[migrations.length - 1].version }, (_, index) => index + 1);
const actualVersions = migrations.map((migration) => migration.version);
if (actualVersions.some((version, index) => version !== expectedVersions[index])) {
  throw new Error(`Migration files must be contiguous from 001; found ${actualVersions.join(",")}.`);
}

const query = `
  select version, filename
    from public.rglrs_migrations
   order by version
`;
const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query }),
  signal: AbortSignal.timeout(60_000),
});
if (!response.ok) {
  throw new Error(`Migration ledger query failed (${response.status}): ${(await response.text()).slice(0, 1000)}`);
}

const payload = await response.json();
const rows = Array.isArray(payload) ? payload : payload?.result || payload?.data || [];
if (!Array.isArray(rows)) throw new Error("Migration ledger response was not a row array.");
if (rows.length !== migrations.length) {
  throw new Error(`Migration ledger has ${rows.length} rows but the repository has ${migrations.length} migrations.`);
}
for (const [index, migration] of migrations.entries()) {
  const row = rows[index];
  if (Number(row?.version) !== migration.version || row?.filename !== migration.fileName) {
    throw new Error(`Migration ledger mismatch at ${migration.fileName}.`);
  }
}

const latest = migrations[migrations.length - 1];
const digest = createHash("sha256").update(files.join("\n")).digest("hex").slice(0, 12);
console.log(`Migration state passed: ${migrations.length} ordered migrations through ${latest.fileName} (${digest}).`);