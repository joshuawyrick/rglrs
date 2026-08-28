import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
const projectRef = projectUrl?.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co/i)?.[1];

if (!projectRef || !accessToken) {
  console.error(
    "Supabase privacy tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_ACCESS_TOKEN.",
  );
  process.exit(1);
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const testDirectory = path.resolve(scriptDirectory, "../db/tests");
const testFiles = [
  "schema_contract.sql",
  "audience_rls.sql",
  "core_privacy_rls.sql",
  "saved_collections_rls.sql",
  "safety_rls.sql",
  "event_invite_boundaries.sql",
  "private_media_lifecycle.sql",
  "communications_boundaries.sql",
  "friend_network_rls.sql",
  "event_media_privacy.sql",
  "privacy_preferences.sql",
  "event_cover_lifecycle.sql",
  "signup_invite_boundaries.sql",
];

for (const fileName of testFiles) {
  const query = await readFile(path.join(testDirectory, fileName), "utf8");
  let response;
  try {
    response = await fetch(
      `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(60_000),
      },
    );
  } catch (error) {
    console.error(
      `✗ ${fileName} request failed (${error instanceof Error ? error.message : "unknown error"})`,
    );
    process.exit(1);
  }

  if (!response.ok) {
    const body = await response.text();
    console.error(`✗ ${fileName} failed (${response.status})`);
    console.error(body.slice(0, 2_000));
    process.exit(1);
  }

  console.log(`✓ ${fileName}`);
}

console.log("Supabase schema and privacy checks passed.");