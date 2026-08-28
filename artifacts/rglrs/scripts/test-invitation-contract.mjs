import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../db/migrations/034_signup_invites.sql", import.meta.url), "utf8");
const regression = await readFile(new URL("../db/tests/signup_invite_boundaries.sql", import.meta.url), "utf8");
const appUrl = await readFile(new URL("../lib/app-url.ts", import.meta.url), "utf8");
const eventInvite = await readFile(new URL("../components/event-invite.tsx", import.meta.url), "utf8");

assert.match(migration, /token_hash text not null unique check\(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
assert.doesNotMatch(migration, /\btoken text\b/);
assert.match(migration, /redeem_signup_invite_secure\(p_token_hash text\)/);
assert.match(migration, /public\.is_blocked\(v_inv\.created_by,auth\.uid\(\)\)/);
assert.doesNotMatch(migration, /create_friend_request_secure/);
const redeem = migration.slice(migration.indexOf("create or replace function public.redeem_signup_invite_secure"));
const lockIndex = redeem.indexOf("where token_hash=p_token_hash for update");
const priorRedemptionIndex = redeem.indexOf("from public.signup_invite_redemptions r");
const capacityIndex = redeem.indexOf("v_inv.max_uses is not null and v_inv.use_count>=v_inv.max_uses");
const incrementIndex = redeem.indexOf("update public.signup_invites set use_count=use_count+1");
assert.ok(lockIndex >= 0 && priorRedemptionIndex > lockIndex && capacityIndex > priorRedemptionIndex,
  "invite retries must lock, recognize the prior redemption, then reject a full invite");
assert.ok(incrementIndex > capacityIndex && (redeem.match(/set use_count=use_count\+1/g) || []).length === 1,
  "only a new redemption may increment use_count once");
assert.match(regression, /redeem_signup_invite_secure\(repeat\('d',64\)\).*redeem_signup_invite_secure/s);
assert.match(regression, /use_count.*<> 1/);

assert.match(appUrl, /https:\/\/therglrs\.com/);
assert.match(appUrl, /value\.startsWith\("\/\/"\)/);
assert.match(appUrl, /\[\\\\\\u0000-\\u001f\\u007f\]/);
assert.match(appUrl, /5c\|7f/);
assert.match(eventInvite, /QrDownloads/);
assert.match(eventInvite, /printable/);

console.log("Invitation, continuation URL, and QR contracts passed.");