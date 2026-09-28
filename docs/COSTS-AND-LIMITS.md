# TripGuessr costs and limits

Base service prices checked **27 September 2026**; live-stream billing model updated **28 September 2026**. USD list prices before tax/currency conversion; this is a planning model, not a bill or a spending cap. Regional prices below were checked with **Warsaw (europe-central2)** selected in Google's official pricing tables.

## Current setup

`tripguessr.com` → Cloudflare Worker → Cloud Run → Firestore/private Cloud Storage, with Google sign-in through Firebase Authentication **with Identity Platform** (confirmed through the project's configuration API).

Cloud Run, the database and photo bucket are in Warsaw. Authentication and Cloudflare processing are not restricted to that region. No Redis, WebSocket server, Cloud SQL instance, paid map subscription or Google load balancer is required.

| Service | Free allowance / relevant limits | Price or behavior above it |
| --- | --- | --- |
| [Cloudflare Workers](https://developers.cloudflare.com/workers/platform/pricing/) | Current plan: Free. 100,000 requests/day **across the account**, 10 ms CPU/request. Proxy requests for pages, photos, assets and polling all count. | Free plan requests fail after the daily allowance; it does not silently upgrade. Paid Workers starts at $5/month, including 10M requests and 30M CPU-ms; then $0.30/M requests and $0.02/M CPU-ms. |
| [Worker runtime limits](https://developers.cloudflare.com/workers/platform/limits/) | 128 MB memory; 50 subrequests/request on Free. Network waiting is not CPU time. The proxy streams the body and performs one origin fetch. | CPU/memory exhaustion produces errors. Free plan limit is a daily availability risk, not a GCP spending cap. |
| [Cloud Run, request-based](https://cloud.google.com/run/pricing) | Monthly billing-account free credits equivalent to 180,000 CPU-seconds and 360,000 GiB-seconds at Tier 1 prices, plus 2M requests. Warsaw is Tier 2. | Warsaw: **$0.0000336/vCPU-second**, **$0.0000035/GiB-second**, **$0.40/M requests**. Free credits are $4.32 CPU and $0.90 RAM: approximately **128,571 CPU-seconds** and **257,143 GiB-seconds** in Warsaw, not the larger Tier 1 quantities. |
| [Firestore](https://cloud.google.com/firestore/pricing) | One free database/project: 1 GiB stored, 50k document reads/day, 20k writes/day, 20k deletes/day, 10 GiB outbound/month. Daily quotas reset around midnight Pacific time. | Warsaw: **$0.039/100k reads**, **$0.117/100k writes**, **$0.013/100k deletes**, **$0.195/GiB-month** above free storage. Billing is enabled, so exceeding free usage generally incurs charges instead of stopping the app. Backups, PITR and TTL are separate. |
| [Cloud Storage](https://cloud.google.com/storage/pricing) | The 5 GiB Always Free allowance applies to selected US regions; **our Warsaw bucket is not eligible**. Current bucket: Standard, private, flat namespace, 7-day soft delete. | **$0.023/GiB-month**, including retained soft-deleted photos. Standard regional operations: **$0.005/1k Class A** (e.g. uploads), **$0.0004/1k Class B** (e.g. reads). Standard has no minimum storage duration or retrieval charge. |
| [Network transfer](https://cloud.google.com/vpc/network-pricing) | Same-region storage/database-to-Run traffic avoids cross-region transfer. Cloud Run's North America transfer free tier does not apply to Warsaw. | Model uses **$0.12/GiB** Warsaw-to-Europe internet egress for the first TiB. Other destinations can cost more. Cloudflare does **not** make Google-origin outbound traffic free; no CDN-interconnect discount is assumed. |
| [Firebase / Identity Platform](https://cloud.google.com/identity-platform/pricing) | Google/social sign-in: **50k monthly active users free**. Only signed-in creators count here; anonymous game players use app cookies, not Firebase anonymous accounts. | Next 50k MAUs cost **$0.0055 each**, with lower later tiers. Inactive stored accounts are free. No phone/SMS authentication is enabled. |
| [Authentication quotas](https://firebase.google.com/docs/auth/limits) | 100 new accounts/hour/IP; Identity Toolkit general limits include 1,000 operations/second/project and 10M/day; 500/second/service account. Specific endpoints have their own limits. | Throttling can block sign-in or session checks independently of the MAU free tier. Google OAuth is configured External/In production; ordinary players do not go through OAuth. |
| [Map tiles](https://operations.osmfoundation.org/policies/tiles/) | Leaflet is a library; the current tiles come from OpenStreetMap's community servers. **There is no guaranteed numeric free quota or SLA.** | Heavy or noncompliant use may be blocked without notice. Keep visible attribution, normal browser caching and a valid Referer; no offline/bulk tile downloads. Move to a suitable tile provider before sustained growth. No Google Maps API is used. |
| [Place search](https://github.com/komoot/photon#demo-server) | The public Photon demo permits reasonable use, with no guaranteed availability or published fixed allowance. Search happens only when a creator submits it. | Extensive use can be throttled/banned. Our server caches 100 queries for 24h, spaces requests 1.1s apart **per instance**, and permits at most five pending searches/instance. Two instances are not a global 1-request/second limiter. Configure `GEOCODING_URL` for another Photon-compatible provider if needed. |
| [Cloud Build](https://cloud.google.com/build/pricing) | 2,500 promotional free build-minutes/month/billing account for e2-standard-2 in the default pool. | Published e2-standard-2 baseline is $0.006/minute; different machines/regions may differ. Deployment builds and source bundles are separate from serving traffic. |
| [Artifact Registry](https://cloud.google.com/artifact-registry/pricing) | First 0.5 GiB/billing account free. The repository reported about **450 MB** before this release; no cleanup policy was configured. | **$0.10/GiB-month** thereafter. Repeated deployments can grow this even without visitors. Preserve useful rollback versions when introducing cleanup. |
| [Cloud Logging](https://cloud.google.com/products/observability/pricing) | First 50 GiB/project/month for ordinary log storage. Current default log retention: 30 days; required audit logs: 400 days. | Ordinary logging ingestion/storage above free allocation starts at $0.50/GiB including 30 days. Longer retention and some other observability features are separate. |

## App limits and live-session design

Google Auth's branding configuration now uses TripGuessr and the public homepage/privacy/terms URLs. Brand verification is a separate Google process; no verified-brand status is claimed. The app requests only basic identity scopes (`openid`, email, profile). Google's [production-readiness guidance](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview) distinguishes these from unverified sensitive/restricted scopes that trigger the 100-user warning cap. Adding Google Drive/Photos or other scopes would require a fresh quota/verification review.

- 5 trips/creator × 12 photos × 2 MiB maximum = **120 MiB of current photos per account**. This is not a global storage cap. Trips remain until deleted; soft-deleted copies temporarily add storage.
- Cloud Run: **min 0, max 2 instances**, 1 vCPU, 1 GiB RAM, concurrency **80**, 60s timeout. Up to **60 live streams/instance**, two per browser/creator identity. Upload admission permits only **one image-processing request per instance**, before multipart buffering. Limits bound pressure, not spending; excess demand can receive 429s.
- New live lobbies use server-sent events (SSE), with one Firestore listener per room per instance. Commands remain POST requests. Streams close after 45s and reconnect, with 15s heartbeats; hidden/finished/unavailable tabs disconnect. Three-second polling remains a fallback. Existing lobbies retain their previous protocol until replaced.
- 20 players/lobby plus a spectating host, 24h link lifetime, one current lobby/trip. A five-second preparation window preloads photos and sets the same server start/deadline for everyone. Readiness never delays it; slower clients see the remaining time. This reduces normal delivery skew but cannot guarantee simultaneous display on disconnected/slow devices.
- Hosts spectate by default and may join as players. The host starts round one; subsequent rounds can be host-only or any active player. Timers accept 1–3600s, no limit, or X seconds after the first confirmed guess. The latest successfully saved pin counts on timeout/manual reveal; no saved pin means zero. Private draft documents are separate from the room and are never broadcast to opponents before reveal.
- Drafts are versioned and saved at most twice/second per browser. Each save transaction reads the room and draft and writes the draft. Commands/finalization also read drafts (up to 20) transactionally. Readiness, confirmed guesses, joins and phase transitions update the room and its listener. Listener reconnects, contention and separate instances increase reads. `live` and `photos` remain excluded from indexes.
- Per-instance limits: 3,000 API requests/min/network and 6,000/min total; 120 draft saves/min/player, 45 other live requests/min/player; 500 ordinary API requests/15min/browser. Other sign-in/upload/search limits remain. These are per-process abuse controls, not global billing caps.
- Drafts expire with their lobby; optional result snapshots expire after 30 days. TTL deletion is billed and asynchronous; the app blocks expired data immediately. Snapshot links remain independent of replacement lobbies and stop working when a trip is paused/deleted.

## Live connections and costs

[Cloud Run supports streaming HTTP](https://docs.cloud.google.com/run/docs/triggering/https-request). Under [request-based billing](https://cloud.google.com/run/pricing), an instance remains billable while at least one stream is open, including quiet lobby time. Forty 45-second connections occupy approximately the same compute time as one 30-minute stream. Concurrent streams share instance compute; a room spread across two instances can occupy both. Scale-to-zero applies after connections close. No extra service or always-on minimum instance is introduced.

[Firestore listeners are billed for initial reads and document changes](https://firebase.google.com/docs/firestore/pricing). Sharing one server listener per room avoids one database listener per player, but draft writes, transactional reads and reconnects still count. Browser map tiles are separate: lazy result mini-maps reduce unnecessary downloads; there is still no guaranteed OSM capacity allowance.

The old polling-only estimate is replaced by an explicit live-room model. One player-session is 30 minutes, with 10 photos, 10 saved pin moves/photo and 12 MiB transfer (including repeat result images). Model **220 requests, 700 document reads and 125 writes/player-session**; this includes reconnects, readiness, locks and an allowance for draft queries/listener reads. Sustained dragging and fallback polling can exceed it. Add the uptime check's 25,920 requests/month. For five simultaneous browsers/room, assume one or two occupied instances for the room's duration. Rooms overlapping on the same instance can cost less. Free quotas are otherwise unused and traffic is evenly spread over 30 days.

| Live player-sessions/month | Stored trips | Requests/month | Estimated serving total/month |
| ---: | ---: | ---: | ---: |
| 100 | 25 | 47,920 | **about $0.14** |
| 1,000 | 100 | 245,920 | **about $9.56–$22.92** |
| 10,000 | 1,000 | 2,225,920 | **about $145.59–$279.15** |

These are assumptions, not measured bills. Excludes domain, tax, builds/artifacts, logs, photo uploads, database storage, startup overhead, unusual destinations and abuse. A lone browser keeping a lobby open uses compute too; larger groups share it more efficiently. Two instances occupied continuously for 30 days would cost roughly $187 in compute after the assumed credits, before storage/egress/requests. Even the upper example is not a cap.

Under the usage assumptions, 50k free reads/day cover about **71 player-sessions/day**, and 20k writes/day about **160**. Worker Free's 100k/day, less the 864 uptime requests, covers about **450 player-sessions/day** before other traffic. Bursts, bots, other Workers and pin dragging can hit that ceiling earlier. Firestore excess is billed; Worker Free requests can fail at the daily limit. No paid Worker upgrade is made.

```sh
node scripts/estimate-costs.mjs 1000 100 5
# Monthly 30-minute player-sessions, stored trips, simultaneous browsers per room
```

## Practical operating thresholds

Keep this setup for occasional small games. Use a **$5–$10/month planning allowance plus the domain** at low traffic, then compare actual billing/latency with the model after real games. This is an allowance, not a configured cap.

Watch Cloudflare daily requests and CPU errors, Firestore daily reads, Cloud Run billable time/egress/429s/5xx, photo bucket size including soft deletes, and Artifact Registry/source-bundle growth. Set billing alerts before a wider launch; [Google budgets do not cap spending](https://cloud.google.com/billing/docs/how-to/budgets). No new budget or paid plan is configured by this release.

Approach 70k Worker requests/day: investigate idle tabs/bots and decide whether to spend $5 on Workers or reduce request volume. Approach sustained map/search use: arrange capacity with a provider; never work around a provider block. If live traffic grows, compare measured billable instance time, draft write volume and stream reconnects with this model before adding another service. Do not publicly cache private trip photos or personalized API responses to save egress.

## Monitoring update — 28 September 2026

The [observability setup](OBSERVABILITY.md) adds a private dashboard, one bounded activity counter and a three-location uptime check every five minutes (about 25,920 executions/month and 864 origin/Worker requests/day). Native metrics, current uptime checks and this small counter are expected to fit the applicable free allowances at current traffic. Account-wide allowances and origin processing still matter. Private operator email alerts are enabled; Google currently lists alerting charges as starting no sooner than 1 September 2027. No paid monitoring subscription or hard spending cap was added.

Demo runs and leaderboard records now expire after 30 days. Firestore TTL deletions are billed as document deletions; they are not a free-tier guarantee. This uses the existing database and no scheduled service. See [Firestore TTL behavior and pricing](https://docs.cloud.google.com/firestore/native/docs/ttl). Early per-network and per-instance API throttles limit database work but remain per-process controls, not a hard billing cap.
