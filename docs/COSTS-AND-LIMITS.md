# TripGuessr costs and limits

Checked **27 September 2026**. USD list prices before tax/currency conversion; this is a planning model, not a bill or a spending cap. Regional prices below were checked with **Warsaw (europe-central2)** selected in Google's official pricing tables.

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
- Cloud Run: **min 0, max 2 instances**, 1 vCPU, 1 GiB RAM, concurrency 4, 60s request timeout. This controls scaling; it is not a hard billing ceiling. At sustained load, requests can queue or fail. Eight in-flight requests across two instances is not the same as eight players.
- A live lobby supports **20 players**, plus the host if spectating. One current lobby/trip; links expire after 24h. Hosting a new lobby replaces the old live state. Existing solo progress remains separate.
- Each active visible browser polls every **3 seconds**, reading one game document. No idle writes and no always-open Cloud Run connection. Hidden tabs stop polling; returning to the tab refreshes it. Finished sessions stop polling. Changes usually appear within a polling interval plus network latency; photos are synchronized by round, not streamed at frame precision.
- Joining, guesses, host actions and timer reveals use Firestore transactions. Retries/contention can add reads. `live` and `photos` fields are excluded from indexes. One document per lobby is intentionally bounded to small groups; higher-scale live play would need a different synchronization design.
- The host starts each round. All confirmed guesses or timer expiry trigger reveal; disconnected players get 0 at expiry. In untimed games the host can remove an absent player or reveal manually. A deadline is checked on the next request; it does not require a paid background scheduler.
- Rate limits are per running instance: 500 ordinary API requests/15 min/browser, 45 live requests/min/browser, separate sign-in/upload/search limits. They deter casual abuse but do not stop distributed abuse or users creating many accounts.

## What traffic fits the free tiers?

One **30-minute player-session** means one active browser, including time in the lobby/results. Assume 10 photos, 0.5 MiB each, about 600 polls plus actions/assets: use **650 requests and 650 database reads** per session for planning. A spectating host also counts. Photo display and result thumbnails can fetch a photo twice; budget **12 MiB transferred/session**, including app/polling traffic.

Under those assumptions:

- Firestore's free reads cover about **76 player-sessions/day**. Extra reads are inexpensive; a burst of 100k reads costs about $0.0195 above that day's free 50k.
- Workers Free covers about **153 player-sessions/day**, before other visitors, bots or account Workers. That's roughly seven 30-minute rooms with 20 players plus a spectating host. A crowded single day matters even if the monthly average is low.
- 100k Worker requests could also be about 5,000 active browser-minutes of polling alone. Leaving visible lobbies open for hours consumes the allowance without additional games.
- At 0.1–0.3 allocated instance-seconds/request, Cloud Run's Warsaw CPU credit covers roughly **1.29M–429k requests/month**, before startup/shutdown/upload work. Overlapping requests share compute, so request count alone cannot predict compute cost accurately.

## Monthly planning scenarios

Assume traffic evenly spread over 30 days, other projects have not consumed shared free allowances, 1 CPU/1 GiB, and 0.1–0.3 allocated instance-seconds/request. These are calculated examples, **not measured production latency or promised bills**.

| Live player-sessions/month | Stored trips | Requests/month | Estimated serving total/month |
| ---: | ---: | ---: | ---: |
| 100 | 25 | 65,000 | **about $0.14** |
| 1,000 | 100 | 650,000 | **about $1.43–$3.66** |
| 10,000 | 1,000 | 6.5M | **about $42–$90**, including a hypothetical $5 Workers upgrade |

The current **Free Worker would not serve the 10k scenario reliably**: its average is already 217k requests/day. No paid upgrade was made. All examples exclude the domain renewal, tax, build/artifact storage, log overages, startup effects, upload writes, database writes/storage overages, unusual destinations, repeated downloads and abuse. These are normally small at friends-and-family scale, but are not zero by definition. Double photo sizes approximately doubles the image-transfer portion. Solo games do not poll and consume far fewer API requests.

Reproduce/adapt the model:

```sh
node scripts/estimate-costs.mjs 1000 100
# Arguments: monthly 30-minute player-sessions, stored trips
```

## Practical operating thresholds

Keep this setup for occasional small games. Use a **$5–$10/month planning allowance plus the domain** at low traffic, then compare actual billing/latency with the model after real games. This is an allowance, not a configured cap.

Watch Cloudflare daily requests and CPU errors, Firestore daily reads, Cloud Run billable time/egress/429s/5xx, photo bucket size including soft deletes, and Artifact Registry/source-bundle growth. Set billing alerts before a wider launch; [Google budgets do not cap spending](https://cloud.google.com/billing/docs/how-to/budgets). No new budget or paid plan is configured by this release.

Approach 70k Worker requests/day: investigate idle tabs/bots and decide whether to spend $5 on Workers or reduce polling. Approach sustained map/search use: arrange capacity with a provider; never work around a provider block. If live traffic grows, evaluate push updates with measured costs before adding another service. Do not publicly cache private trip photos or personalized API responses to save egress.

## Monitoring update — 28 September 2026

The [observability setup](OBSERVABILITY.md) adds a private dashboard, one bounded activity counter and a three-location uptime check every five minutes (about 25,920 executions/month and 864 origin/Worker requests/day). Native metrics, current uptime checks and this small counter are expected to fit the applicable free allowances at current traffic. Account-wide allowances and origin processing still matter. Private operator email alerts are enabled; Google currently lists alerting charges as starting no sooner than 1 September 2027. No paid monitoring subscription or hard spending cap was added.

Demo runs and leaderboard records now expire after 30 days. Firestore TTL deletions are billed as document deletions; they are not a free-tier guarantee. This uses the existing database and no scheduled service. See [Firestore TTL behavior and pricing](https://docs.cloud.google.com/firestore/native/docs/ttl). Early per-network and per-instance API throttles limit database work but remain per-process controls, not a hard billing cap.
