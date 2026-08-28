# Backup and restore runbook

## Current provider verification

As of 2026-08-28, the connected Supabase project reported two backups and WAL
support, but `pitr_enabled=false` and physical backup data disabled. The
connected Cloudflare account reported the private `rglrs-media` bucket with
only the default incomplete-multipart-abort lifecycle rule. Treat this as
**not ready for external users** until an owner enables the intended Supabase
PITR/backup retention and R2 retention/versioning settings, then repeats the
checks below. Do not infer recoverability from a non-empty backup list.

## Ownership and recovery targets

The release owner is accountable for the drill. The Supabase project owner
performs database recovery; the storage owner validates the private R2 bucket.
Record named primary and backup owners in the private operations tracker before
launch. Never put credentials or user data in the drill record.

Set recovery point and recovery time objectives appropriate to the current
Supabase plan and beta risk. If the plan cannot meet them, do not claim that it
can: document the limitation and obtain release-owner acceptance.

## Before every release

1. Confirm the most recent Supabase backup/PITR point is healthy and note its
   UTC timestamp and project reference.
2. Record the exact application revision and the ordered migrations included in
   it (`001_initial.sql` through `031_place_autocomplete.sql`), verified by
   `pnpm --filter @workspace/rglrs run migrations:check`.
3. Export R2 bucket configuration and lifecycle/CORS rules. R2 object recovery
   is separate from the database; enable and verify the retention/versioning
   controls required by the storage plan.
4. Confirm the previous application deployment remains available for rollback.
5. Do not use a production data export on a developer laptop as a backup.

## Quarterly restore drill

Use an isolated, access-controlled Supabase project and private R2 test bucket.
Never overwrite production.

1. Start an incident record with owner, start time, chosen recovery point, and
   expected RPO/RTO.
2. Restore the selected managed backup into the isolated project using the
   Supabase dashboard/support procedure for the subscribed plan.
3. If a blank-project rebuild is being tested instead, apply every migration in
   numeric order from `001` through `029`; do not treat that as restoration of
   user rows.
4. Configure temporary server secrets for the isolated environment only. Use a
   newly generated `SESSION_SECRET`; never copy the production cleanup secret.
5. Validate schema migration state, row counts, foreign-key integrity, and RLS.
   Run `pnpm --filter @workspace/rglrs run privacy:test` against the isolated
   project.
6. Run `docs/TWO_ACCOUNT_RELEASE_TEST.md` with disposable accounts against the
   isolated environment.
7. For sampled media records, verify the corresponding private R2 object,
   metadata, content length, and authorized read. Verify unauthorized reads
   fail. Do not make the bucket public.
8. Run the production build and route smoke gate against the isolated
   environment.
9. Record achieved RPO/RTO, failed checks, remediation owner/due date, and end
   time. Destroy temporary credentials and the isolated environment according
   to retention policy.

## Production recovery

Declare an incident and freeze writes/publishing. Preserve logs and timestamps.
The database owner selects the recovery point; a second operator verifies it.
Restore to isolation first when the incident allows, validate the checks above,
then follow the provider-approved cutover procedure. Roll back the application
revision when the schema is backward compatible; never run destructive reverse
SQL ad hoc. After cutover, rotate exposed credentials, run smoke/privacy checks,
monitor structured error IDs, and document the post-incident review.