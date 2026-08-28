# Two-account production privacy test

Run this test before every external beta release against the exact published
origin. Use two disposable, verified accounts that are not real users. Prefix
all generated names with `release-test-<UTC timestamp>` and delete both accounts
and their media after the test.

## Record

Store only credential-free evidence in the release record:

- published application revision and origin
- UTC start/end time
- pass/fail for each section below
- safe error IDs for failures
- confirmation that disposable accounts and R2 objects were removed

Never store passwords, cookies, access tokens, private media URLs, object keys,
or user content in the record.

## 1. Authentication and profiles

1. Sign up and verify Account A and Account B.
2. Complete both profiles and confirm sessions survive a refresh.
3. Sign out and sign back in to each account.
4. Confirm password recovery returns only to the published origin.

## 2. Friendship and feed revocation

1. Account A sends a friend request; Account B accepts it.
2. Account A creates a Friends post with a unique caption.
3. Confirm Account B sees the post in an already-open feed.
4. Account A removes the friendship.
5. Confirm Account B's open feed removes the post without a manual reload.
6. Repeat with a block and verify direct post/media requests no longer succeed.

## 2a. Privacy settings

1. Set Account A's profile to visible to everyone, then deny Account B using a
   person override. Confirm B cannot discover or open A while another unrelated
   disposable account still can.
2. Deny requests and messages for B. Confirm an allow selected by B cannot
   bypass A's denial.
3. Save a Friends/default-downloads-off post template, create a post without
   changing its audience, and confirm the template is applied.
4. Confirm Privacy screens and RPC responses never contain account email.

## 3. Contributor-specific event privacy

1. Create an event with Accounts A and B plus a third disposable contributor
   when available.
2. Have each contributor upload uniquely identifiable event media.
3. Account A excludes Account B under “My sharing.”
4. Confirm B loses only A's event media and remains able to see permitted media
   from the other contributor.
5. Confirm the event membership count and B's membership remain unchanged.
6. Remove the exclusion and verify A's media becomes visible again.
7. Unshare one of A's event posts and verify it disappears for event members
   while remaining private to A.

## 4. Downloads and private-media identifiers

1. With downloads disabled, confirm B cannot download A's media.
2. Enable downloads and confirm B can save the authorized attachment.
3. Remove B's audience access and confirm the same download route now fails.
4. Inspect browser network responses and confirm post/message payloads never
   include R2 object keys or permanent storage URLs.
5. Confirm signed-out and unrelated sessions cannot fetch private post media or
   message attachments by identifier.

## 5. Messaging and cleanup

1. Exchange a message attachment and verify only conversation participants can
   view it.
2. Remove a participant where supported and verify future attachment reads fail.
3. Delete the disposable accounts and run the media cleanup command.
4. Confirm no release-test rows or R2 objects remain.

## Release decision

Any privacy, download, or storage-key failure blocks the release. Fail closed,
retain the safe Error ID, and roll back rather than disabling RLS or making R2
public.