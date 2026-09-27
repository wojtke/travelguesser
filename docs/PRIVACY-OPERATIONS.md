# Privacy operations

Operator: **Wojciech Jasiński, Poland — woj.jasinski@gmail.com**. Reviewed for this implementation on 27 September 2026. Public notices live at `/privacy`, `/terms` and `/cookies`.

This release implements a privacy baseline. Publishing a notice alone does not establish compliance with every applicable law. The operator still needs to handle requests/reports, maintain appropriate vendor arrangements and review changes in how the service is used.

## Controls implemented

- No public trip list: `/api/host/games` requires a creator session and returns only that creator's trips.
- New trip and lobby links have independent 128-bit random identifiers. Existing trip IDs and data are preserved.
- All `/g/`, `/create` and `/api/` responses carry `X-Robots-Tag: noindex, nofollow, noarchive, noimageindex, nosnippet`. Private API/photos also use `no-store`. `robots.txt` deliberately allows crawling so engines can actually see the noindex response. [Google's noindex guidance](https://developers.google.com/search/docs/crawling-indexing/block-indexing) explains why a robots disallow is not equivalent.
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
| Default app/request logs | Google Cloud Logging | Verified `_Default`: **30 days**. |
| Required audit logs | Google Cloud Logging | Verified `_Required`: **400 days**. Other providers have their own security/operational retention. |
| Local operator backups from earlier migration/admin work | Ignored `.local/` on the operator's computer | Not public GitHub content; include them when handling deletion/export requests. Keep only as long as there is a documented need. |

The domain proxy does not intentionally record bodies, credentials or photo contents. Infrastructure request logs can contain private trip paths/IPs; keep log access restricted. Cloudflare/Firebase/global support processing means the whole service is not exclusively EU-resident.

## Handling a privacy or content request

1. Receive requests at the listed operator email. Acknowledge promptly and track the request date. [EDPB guidance](https://www.edpb.europa.eu/sme/be-compliant/respect-individuals-rights_en) explains applicable rights and response expectations; normally respond within one month.
2. Verify identity proportionately. A creator can use the account email plus authenticated context; an anonymous player may need trip/nickname/browser context. Do **not** ask for passwords, Google tokens or session cookies by email. Do not disclose another participant's data in an export.
3. For a creator export, retrieve their Firebase profile and games selected by `ownerUid`, with their photo objects and relevant account quota record. For a player export/correction/deletion, locate only the verified player's hashed run identifier/live entry. Use operator access through `scripts/admin-cloud.mjs`; no new runtime account-admin permissions are needed.
4. For account deletion, delete that creator's owned trips through the normal store deletion path first (media, runs, leaderboard, quota slots), remove the creator quota document, then delete the Firebase user and revoke sessions. Review any operator backups/support copies. Deleting only the Firebase login leaves trips behind and is insufficient.
5. For a reported photo, pause the affected trip while assessing a credible urgent privacy complaint, then remove/correct the relevant data as warranted. Share the outcome with the requester and affected creator where appropriate. Do not promise that saved third-party copies can be recalled.
6. Keep a minimal record of the request, verification method, decision and completion date; avoid retaining the exported content unnecessarily. Explain any lawful retention/extension and complaint rights. [UODO's complaint instructions](https://uodo.gov.pl/en/681/1404) are linked in the notice.

## Ongoing operator responsibilities

Review the applicable [Google Cloud data processing terms](https://cloud.google.com/terms/data-processing-addendum), [Firebase processing information](https://firebase.google.com/support/privacy) and [Cloudflare DPA](https://www.cloudflare.com/cloudflare-customer-dpa/), including international-transfer arrangements. This release did not sign new legal agreements on the operator's behalf. Keep a simple processing/vendor inventory matching the public notice and review whether additional disclosures are needed for the operator's legal status/audience.

Have a process for content complaints and security incidents. Assess breach notification duties promptly with the appropriate authority/adviser; do not wait for routine maintenance. Restrict cloud/GitHub administration, maintain account recovery and review access regularly. If the service becomes commercial, targets children, adds tracking or processes sensitive content, obtain a focused legal review and revise the product/notices before that change. The current terms set an intended audience of 16+; this is not an age-verification system.

Do not enable analytics, optional tracking, public galleries or globally cached private photos without revisiting privacy choices. Search-engine exclusion is best effort; use authenticated invitations if future trips require stronger access control.
