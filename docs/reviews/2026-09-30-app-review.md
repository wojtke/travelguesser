# TripGuessr application review

Reviewed on 30 September 2026 at commit `ffecb5b4702aa9a4ae522e3996b8e61cc681f9d2`. Three independent reviewers covered code and reliability, security and privacy, and UI/UX/accessibility. The coordinating reviewer checked deployment validation, documentation consistency and the reported findings.

The main issues are ranked-score integrity, a blocked lobby cancellation flow, keyboard access to live guessing, unclear practice consequences and stale search results. No critical or high-severity security defect was confirmed within the reviewed scope. This is a targeted application review, not a penetration test or security certification.

Status: R1–R8 have been addressed in the maintenance change that adds this resolution record. The findings below preserve the original review evidence; their source line numbers refer to the reviewed commit. The review itself made no application or production changes. Implementation and verification are recorded separately below.

## Priorities and evidence

P2 means a functional, integrity or accessibility issue to fix in the next maintenance release. P3 means a lower-impact privacy consistency issue or operational follow-up. Findings are deduplicated across reviewers.

| ID | Priority | Finding | Evidence |
| --- | --- | --- | --- |
| R1 | P2 | Ranked attempts survive answer exposure in friend rooms | Two independent synthetic local reproductions |
| R2 | P2 | Empty public lobbies have no cancellation control | Local service reproduction and UI rendering-path inspection |
| R3 | P2 | Keyboard users cannot place a live guess | Local browser reproduction and code inspection |
| R4 | P2 | Default practice choice does not explain loss of ranked eligibility | Frontend and backend control-flow inspection |
| R5 | P2 | Older search responses overwrite newer filter results | Actual loader function exercised with controlled promises |
| R6 | P3 | Some limiter keys contradict the salted-hash privacy description | Application and installed dependency inspection |
| R7 | P3 | Release checks accept an unavailable daily challenge | Release script executed against synthetic responses |
| R8 | P3 | README request-limit values are stale | Documentation compared with runtime defaults |

## Findings from the review

### R1 Ranked attempts remain eligible after live answer exposure

Sources: [public-service.js](../../server/public-service.js), lines 137–145, 241–249, 347–348 and 364.

A signed-in player can start a ranked solo attempt, open a friend room for the same edition, reveal the answers there, and finish the original attempt with a ranked score. `markExposure()` preserves an existing claim, while ranked completion checks suspension, score existence and withdrawal without checking later exposure. Ordinary two-tab actions are enough; no extra account or cookie manipulation is needed.

Both code and security reviewers reproduced this independently with synthetic trips. One two-photo reproduction revealed both answers through the live room and then recorded a 10,000-point public score with the original run still ranked. No production leaderboard entries were created.

Recommended fix: transactionally invalidate an active ranked attempt when the same account/browser enters another answer-revealing mode, and explain the downgrade. Alternatively block that exposure until the ranked attempt ends. Recheck exposure state when publishing the score so concurrent requests cannot bypass the rule. Add regressions for both hosting and joining, including concurrent exposure/completion.

Confidence: high.

### R2 Hosts cannot cancel an unwanted empty public lobby

Sources: [LiveGame.jsx](../../client/src/LiveGame.jsx), lines 137–235 and 480–483; [public-service.js](../../server/public-service.js), lines 310–335.

The backend allows one active public room per account and instructs a blocked host to end the existing room. The lobby screen has role selection and Start, but no End/Cancel control. Start is disabled without players. The end action appears only on round results. A host who chose the wrong trip or settings must wait for the fifteen-minute idle expiry or join, start and reveal a round to reach that control.

A local reproduction created an empty lobby, confirmed that another creation returned 409, then used the existing backend `end` action and successfully created another room. The missing UI action was confirmed by both the code and UI reviewers.

Recommended fix: expose a host-only Close lobby action using the existing endpoint, and provide a link back to the active room when creation is blocked. Make ending available during an active round too. Cover create → cancel empty lobby → create another in a browser regression.

Confidence: high.

### R3 Live guessing lacks a keyboard selection method

Sources: [LiveGame.jsx](../../client/src/LiveGame.jsx), lines 301–323; [Map.jsx](../../client/src/Map.jsx), lines 56–60; compare [Game.jsx](../../client/src/Game.jsx), line 403.

Live guessing only changes the pin through a map click. It omits the coordinate fields already present in solo play. Leaflet keyboard controls move or zoom the map but do not select a guess; the confirm button remains disabled until a pin exists.

The UI reviewer reproduced this in an isolated synthetic live round at a 390 × 844 viewport: open the map with Enter, focus it, and use arrows, Enter and Space. No pin was placed and “Drop a pin to guess” remained disabled. The accessibility tree exposed zoom controls and attribution links, with no coordinate-selection alternative.

Recommended fix: reuse the solo coordinate fields, or add an accessible keyboard action that places a pin at the map centre. Preserve draft saving and timeout behavior. Add a browser test that completes a live guess using only the keyboard.

Confidence: high.

### R4 Starting practice does not clearly explain ranked forfeiture

Sources: [Game.jsx](../../client/src/Game.jsx), lines 24 and 180–207; [public-service.js](../../server/public-service.js), lines 124–145 and 173.

Ranked consent starts unchecked, and the explanation for that default says only “Practice scores are not published.” Joining practice immediately records exposure. A signed-in player who reasonably expects to practise before a ranked attempt then loses eligibility for that edition on their account. Guest exposure also affects eligibility in the same browser.

This follows directly from the frontend state and backend eligibility checks. No real user's attempt was consumed during the review. The restriction itself is consistent with the intended first-attempt rule; the problem is that the start flow does not clearly state its consequence.

Recommended fix: explain before starting that practice uses the first attempt and prevents a later ranked score for that edition. Distinct Start ranked attempt and Start practice actions would make the choice clearer. Keep public-score consent explicit and unselected by default. Test both signed-in and guest explanations.

Confidence: high.

### R5 Older requests can replace the selected filter results

Sources: [Community.jsx](../../client/src/Community.jsx), lines 17–34 and 65; analogous pattern in [CommunityAdmin.jsx](../../client/src/CommunityAdmin.jsx), lines 17–26 and 27–39.

Every Explore request unconditionally updates items, cursor and loading state. Category changes remain available during loading. If an Official request starts first but finishes after a newer Community request, official trips replace the community results while Community remains selected. Pagination can also carry stale results across a filter change.

The coordinating reviewer executed the actual source `load()` function with controlled promises: Community resolved first, Official resolved second, and the final item was the official fixture despite the current Community selection. This was a source-function reproduction, not a network-throttled browser test. The analogous admin list/score loaders were inspected but not separately reproduced.

Recommended fix: bind responses, errors, loading state and pagination to a request generation or query key; ignore stale responses and optionally abort obsolete requests. Apply the same protection to admin tabs and selected-trip score loads. Test deliberately reversed response order.

Confidence: high for Explore; code-backed follow-up for Admin.

### R6 Three limiter keys do not match the privacy description

Sources: [app.js](../../server/app.js), lines 178–185, 207–214 and 252–259; [Legal.jsx](../../client/src/Legal.jsx), lines 52–54; [OBSERVABILITY.md](../OBSERVABILITY.md), Logging and privacy.

Login, place-search and upload limiters omit `keyGenerator`, so the library uses IP-derived network addresses as keys. Other network limiters use the shared salted helper. The privacy description says short-lived network counters are keyed by salted hashes without mentioning these exceptions.

This is limited to transient in-memory keys. The review found no evidence that these keys are logged or persisted, and this finding should not be described as a data leak.

Recommended fix: use `privateNetworkKey` for these three limiters too, or accurately narrow the public description. Check that the change preserves intended throttling and IPv6 grouping.

Confidence: high; low impact.

## Operational follow-ups

### R7 Daily availability is not checked by the release gate

Source: [check-release.mjs](../../scripts/check-release.mjs), lines 35–37.

The release check asserts a 200 response and a date-shaped string, but never checks the daily `trip`. Running the actual script with a synthetic `{ date: '2026-09-30', trip: null }` response still printed PASS.

The app intentionally supports an official-trip fallback when a daily is withdrawn or missing, so failing every such deployment is a product/operations choice, not an automatic fix. Define that contract explicitly: either require a usable current daily for release success, or report degraded daily availability clearly while permitting the documented fallback. Add fixtures for missing daily data and malformed challenge metadata.

Confidence: high about the check's behavior. No current production daily outage is asserted.

### R8 README understates the configured request limits

Sources: [README.md](../../README.md), line 141; [request-limits.js](../../server/request-limits.js), lines 10–12; [COSTS-AND-LIMITS.md](../COSTS-AND-LIMITS.md), App limits and live-session design.

README says 900 API requests per minute per network and 3,000 total per instance. Runtime defaults are 3,000 and 6,000; the cost document already matches them. This can mislead operational planning or an abuse review.

Recommended fix: correct README and point to one canonical limits reference, keeping per-process controls distinct from global quotas or spending caps.

Confidence: high.

## Positive observations

- Owner/admin authorization, CSRF/origin checks, report-receipt secrets, answer filtering, metadata stripping and sanitized telemetry have deliberate controls. No additional verified critical/high issue was found in the examined paths.
- Staged Firestore writes, idempotent score publication, explicit source-deletion cleanup and room revocation epochs are useful safeguards.
- Live Explore was readable at a 390 × 844 viewport without horizontal overflow. Mobile gameplay initially leaves the photo unobscured, and map open/close controls worked.
- Solo and creation flows already offer coordinate entry. Existing tests cover several earlier upload, mobile, timing, sharing and synchronization requirements.
- The security review ran `npm audit --omit=dev --json` against the npm registry on 30 September 2026: zero known vulnerabilities across 316 production dependency entries. This checks published advisories, not unknown or application-level flaws.

## Coverage and remaining uncertainty

The reviewers inspected source, existing tests and operational documentation. They used targeted synthetic LocalStore reproductions, a local browser session and read-only live Explore inspection. The coordinating reviewer checked exact source references and independently reproduced the search response race and daily release-check behavior. Screenshots were inspected in browser tool output but were not saved as standalone artifacts. The temporary browser viewport and server were cleaned up.

The prior release's 81 automated checks had passed. This review did not rerun the entire suite; its additional targeted cases expose gaps in that coverage. Follow-up regressions should cover ranked exposure after starting an attempt, empty-lobby cancellation, keyboard-only live play and reversed request order. Scheduling repair currently has a short fixture rather than validation against a fully populated year.

Production IAM, bucket policies, live Firebase configuration, provider logs and real-user data were not inspected. No production exploit attempts, ranked scores, rooms or reports were created. There was no full screen-reader audit, real iOS/Android device test, sustained load test or cloud concurrency reproduction.

Proxy topology needs a controlled staging check: the Worker preserves forwarding headers and Express trusts one proxy hop. The actual Cloudflare-to-Google header chain may affect whether network limits group unrelated visitors. This remains an unverified deployment question, not a confirmed spoofing vulnerability. Do not blindly trust `CF-Connecting-IP` while the Cloud Run origin also accepts direct public requests.

## Resolution record

Implemented on 30 September 2026, in the commit that adds this report and its regression tests. Git history connects the review IDs below with the fixing change; the corresponding GitHub Actions run records deployment status.

| ID | Resolution | Regression evidence |
| --- | --- | --- |
| R1 | Later exposure changes claim state. Active ranked runs recheck account and original-browser claims transactionally and become practice with an explanation. Completed scores remain valid; legacy runs are supported. | Local server tests for hosting, joining, legacy runs, signed-out browser exposure followed by another-browser resume, and completed-score preservation; Firestore emulator test for concurrent live exposure and ranked progress across two service instances. |
| R2 | Close lobby is available before starting; End session is available in active-round host controls. A blocked creation links to the existing room. | Browser flow creates a room, encounters the one-room limit, returns to close it, creates a replacement, and ends an active round. |
| R3 | Live guessing reuses accessible coordinate fields and the normal saved-pin path. | Mobile browser test enters coordinates and confirms a saved guess using keyboard controls. |
| R4 | Start practice and Start ranked attempt name the chosen mode. Guest/account wording explains the first-attempt consequence; ranked consent stays unchecked. | Browser test checks both explanations and verifies that a practice start remains unranked and consumes eligibility. |
| R5 | Request guards reject outdated responses, errors and completion state by view and request generation. Admin list, scores and lookup flows are guarded too. | Browser tests deliberately reverse filter/page responses, admin tab responses, selected-trip scores and edition lookups. |
| R6 | Sign-in, place-search and upload limiters use the same salted network-key helper. | Tests inspect actual in-memory limiter keys on all three routes and preserve IPv6 subnet grouping. |
| R7 | Daily metadata is validated. Missing daily content with a working official fallback produces an explicit DEGRADED warning and CI summary; malformed content fails. | Release-check fixtures cover healthy/degraded responses, missing fallback, stale dates, missing data, incorrect timers/round counts and answer leakage. |
| R8 | README matches the 3,000/network and 6,000/instance runtime limits and links to the operating reference. | Compared with runtime defaults and the cost/limits document. |

Local verification: 72 server tests, seven Firestore emulator tests and all thirteen browser scenarios passed (the four new browser scenarios were rerun after correcting their fixture setup). Formatting and production build passed. The mobile coordinate-entry screenshot was visually checked. CI reruns the complete suites before deployment.

The proxy-header topology question, full device/screen-reader audit and sustained load testing remain outside this patch; they were review limitations, not confirmed vulnerabilities. No public email alias, provider trust setting, cloud IAM permission or historical leaderboard record is changed by these fixes.
