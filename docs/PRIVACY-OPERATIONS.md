# Privacy operations

Operator: **Wojciech Jasiński, Poland**. Updated for public editions on 30 September 2026. Public notices live at `/privacy`, `/terms` and `/cookies`.

The operator's personal email has been removed from the site and current documentation at their request. The public `/contact` form now provides private report receipts and two-way replies without a login or email address. A support alias may be published only after forwarding is verified; do not use the private mailbox for outgoing replies. Google Auth's support address is configured separately and needs a valid replacement before it can be changed.

This release implements a privacy baseline. Publishing a notice alone does not establish compliance with every applicable law. The operator still needs to handle requests/reports, maintain appropriate vendor arrangements and review changes in how the service is used.

## Controls implemented

- `/api/host/games` still returns only the signed-in creator's trips. Explicitly published editions have separate IDs and a site directory; original links, players and scores are never migrated into it.
- New trip and lobby links have independent 128-bit random identifiers. Existing trip IDs and data are preserved.
- All `/g/`, `/p/`, `/explore`, `/contact`, `/admin`, `/create` and `/api/` responses carry `X-Robots-Tag: noindex, nofollow, noarchive, noimageindex, nosnippet`. Private API/photos also use `no-store`. `robots.txt` deliberately allows crawling so engines can actually see the noindex response. [Google's noindex guidance](https://developers.google.com/search/docs/crawling-indexing/block-indexing) explains why a robots disallow is not equivalent.
- Link sharing can be paused by the owner; this also ends the current live session. Non-owners then cannot retrieve trip metadata, photos, leaderboards or live state. Re-enabling sharing reuses the trip link. This is **bearer-link access**, not an invitation allowlist, end-to-end encryption or a guarantee against copying/search engines that ignore instructions.
- The storage bucket is private, uniform access/PAP enforced. Firestore client rules deny access; the backend checks creator ownership and player progress. Answers and others' live guesses stay hidden until reveal. The host uploaded the photos and necessarily knows their locations.
- GPS is parsed in the browser. Photos are resized/re-encoded without EXIF/XMP; only the assigned coordinates/caption are retained separately. No device geolocation or face recognition is used.
- `strict-origin` referrer policy sends only the site origin to tiles/external links, not the trip link. It preserves the valid Referer required by OSM. Third-party map requests can still reveal the area being viewed.
- Essential HttpOnly, Secure production cookies identify players, prevent CSRF and hold the five-day creator session. No analytics/advertising trackers. Optional persistent nickname-prefill storage was removed; old keys are cleared on load. Firebase uses in-memory persistence and signs out its client SDK after exchanging the token for the server cookie.
- Trip creation warns about link forwarding, content rights and sensitive locations. Sign-in/setup link the notices; the footer exposes them publicly without login.

## Data lifecycle (actual behavior)

| Data | Location | Deletion/retention |
| --- | --- | --- |
| Creator UID, email/basic profile, account/sign-in metadata | Firebase Authentication / Identity Platform | Until account deletion; not copied into game results. |
| Trips, host names, coordinates/captions, solo runs/leaderboards, current live state | Firestore, Warsaw | Owner trip deletion removes game and child collections. Previous live state is replaced on a new lobby. No automatic published-trip expiry. |
| Processed photos | Private GCS bucket, Warsaw | Removed from active storage with trip deletion, then **7-day soft-delete retention**. No original file names/originals retained. |
| Live invite | Embedded in trip document | Access expires after **24h**; expiry is **not physical deletion**. |
| Sanitized application logs and remaining default logs | Google Cloud Logging | `_Default`: **30 days**. New raw request entries for this service are excluded; older entries expire normally. |
| Required audit logs | Google Cloud Logging | Verified `_Required`: **400 days**. Other providers have their own security/operational retention. |
| Local operator backups from earlier migration/admin work | Ignored `.local/` on the operator's computer | Not public GitHub content; include them when handling deletion/export requests. Keep only as long as there is a documented need. |

The domain proxy does not intentionally record bodies, credentials or photo contents. Routine Cloudflare invocation logging is disabled, and new raw Cloud Run request records are excluded after verifying the replacement structured logs. Application telemetry uses route templates and aggregate operation counts without visitor identities. Historical request logs and provider security/exception records can still contain private paths or IPs; keep access restricted. See [monitoring and privacy details](OBSERVABILITY.md). Cloudflare/Firebase/global support processing means the whole service is not exclusively EU-resident.

## Handling a privacy or content request

1. When a request is received, acknowledge promptly and track the request date. Check Admin → Reports, acknowledge through the private receipt and record a clear decision/reason. [EDPB guidance](https://www.edpb.europa.eu/sme/be-compliant/respect-individuals-rights_en) explains applicable rights and response expectations; normally respond within one month.
2. Verify identity proportionately. A creator can use the account email plus authenticated context; an anonymous player may need trip/nickname/browser context. Do **not** ask for passwords, Google tokens or session cookies by email. Do not disclose another participant's data in an export.
3. For a creator export, retrieve their Firebase profile and games selected by `ownerUid`, with their photo objects and relevant account quota record. For a player export/correction/deletion, locate only the verified player's hashed run identifier/live entry. Use operator access through `scripts/admin-cloud.mjs`; no new runtime account-admin permissions are needed.
4. For account deletion, delete that creator's owned trips through the normal store deletion path first (media, runs, leaderboard, quota slots), remove the creator quota document, then delete the Firebase user and revoke sessions. Review any operator backups/support copies. Deleting only the Firebase login leaves trips behind and is insufficient.
5. For a reported photo, pause the affected trip while assessing a credible urgent privacy complaint, then remove/correct the relevant data as warranted. Share the outcome with the requester and affected creator where appropriate. Do not promise that saved third-party copies can be recalled.
6. Keep a minimal record of the request, verification method, decision and completion date; avoid retaining the exported content unnecessarily. Explain any lawful retention/extension and complaint rights. [UODO's complaint instructions](https://uodo.gov.pl/en/681/1404) are linked in the notice.

## Ongoing operator responsibilities

Review the applicable [Google Cloud data processing terms](https://cloud.google.com/terms/data-processing-addendum), [Firebase processing information](https://firebase.google.com/support/privacy) and [Cloudflare DPA](https://www.cloudflare.com/cloudflare-customer-dpa/), including international-transfer arrangements. This release did not sign new legal agreements on the operator's behalf. Keep a simple processing/vendor inventory matching the public notice and review whether additional disclosures are needed for the operator's legal status/audience.

Have a process for content complaints and security incidents. Assess breach notification duties promptly with the appropriate authority/adviser; do not wait for routine maintenance. Restrict cloud/GitHub administration, maintain account recovery and review access regularly. If the service becomes commercial, targets children, adds tracking or processes sensitive content, obtain a focused legal review and revise the product/notices before that change. The current terms set an intended audience of 16+; this is not an age-verification system.

Do not enable analytics, optional tracking or globally cached private photos without revisiting privacy choices. Search-engine exclusion is best effort; use authenticated invitations if future trips require stronger access control.

## Review fixes — 28 September 2026

- Demo progress and leaderboard scores expire after 30 days, with immediate API filtering and managed Firestore TTL cleanup of both collections. Physical deletion normally follows within 24 hours. This does not expire user-uploaded trips.
- Removing a live participant revokes their current/future photo and group-result access in that session. It cannot retract photos already received, and anonymous link access is not a permanent identity ban.
- Abuse protection uses short-lived in-memory counters and salted network hashes; no persistent IP-based analytics or visitor identifier is added.

## Gameplay update retention

`games/{trip}/liveDrafts` stores one versioned private pin per lobby/player, expiring with the lobby (24h). `games/{trip}/sharedResults` stores opt-in, spoiler-free snapshots with a 30-day `expiresAt`; links are idempotent while valid and do not renew retention. No snapshots are created automatically. Pause/delete blocks snapshots, including old-lobby snapshots; recursive trip deletion removes both collections. TTL runs asynchronously and application access checks expiry immediately. New code does not change the retention of ordinary trips/results.

Enable `expiresAt` TTL on collection groups `liveDrafts` and `sharedResults` using scripts/deploy.sh. Run `PROJECT_ID=... node scripts/migrate-gameplay.mjs` for count-only dry-run, then add `--apply`. It transactionally seeds creator sequence counters and adds public IDs/per-photo score summaries from completed solo runs; it never invents old durations or decreases a sequence. Repeat runs skip already migrated records. Deploy the new runtime before applying to prevent old writers dropping new fields. Existing live protocols remain unchanged.

## Public-edition retention and data requests

Public runs (including exact guesses) and result snapshots: 30 days. Public friend rooms/drafts: 24 hours, with a 15-minute waiting-lobby access deadline. Browser rank-eligibility claims: 30 days. Account eligibility claims and public score summaries: while the edition exists, with score withdrawal available at any time. Closed reports: 180 days after closure; reopening removes the expiry until the next closure. Firestore TTL is asynchronous and billed; APIs check expiry without waiting for deletion. Approved photo/provenance records and precomputed daily manifests persist for operation and rights evidence. Delete unused rejected candidate copies after review; do not retain them indefinitely.

Deleting a source trip recursively removes its public edition, scores, rooms, claims and per-account score references before deleting shared photo objects. Unpublishing only hides access. For an account data request, derive `identityKey(uid)` using the server helper; include `publicProfiles/{hash}`, its score references and the account's `u_{hash}` run/claim documents under public editions. Locate hosted rooms by `hostUid`; inspect only the verified person's records. For erasure, remove their public score rows/references and run/claim records, hosted rooms/drafts and associated result snapshots, then their public profile; include these steps before deleting Firebase identity. Do not delete another creator's editions merely because this player joined them. Anonymous records require proportional browser/trip verification. An operator can page editions for the account-keyed children; this is an occasional administrative operation, never a gameplay scan.

Public rankings use separately revocable consent. Keep consent/terms version and purpose descriptions current; do not add personal emails, Google names or precise guesses to public rankings. Private report messages and decisions must not appear in public logs or GitHub. Contact email is optional; private receipt links contain access secrets. A reporter can use the same receipt for an appeal. No automated email is sent to reporters.

Public sharing changes the service's legal context. The EU Digital Services Act's scope and small/micro-provider exceptions, Poland's electronic-services act (including operator contact/address obligations if applicable), and a free hobby service's economic character need a focused legal assessment before commercial operation or wider promotion. The implemented reporting/reasons/appeal baseline is not a finding that every obligation is met or exempt. Do not publish a home address or personal mailbox as a shortcut. Review vendor processing arrangements and licensing/property/personality rights alongside copyright.
