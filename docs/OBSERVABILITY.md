# Traffic and monitoring

Configured 28 September 2026. Monitoring is private to the existing Google Cloud/Cloudflare account; there is no public analytics endpoint or new tracking SDK.

## Where to look

- [TripGuessr dashboard](https://console.cloud.google.com/monitoring/dashboards/builder/ae2d43c8-8aaa-466c-b317-0e5585cd5d41?project=travelguesser-woj-20260926): request counts/status, activity, latency, memory, Firestore reads, photo storage, incidents and sanitized warnings/errors.
- [Public HTTPS check](https://console.cloud.google.com/monitoring/uptime?project=travelguesser-woj-20260926): checks `https://tripguessr.com/api/health` from Europe, Iowa and Asia Pacific every five minutes, with TLS validation and an expected response body.
- [Cloudflare Worker metrics](https://dash.cloudflare.com/aecc316547dcfae9a564e9585c2e5e9b/workers/services/view/tripguessr-proxy/production/metrics): domain proxy invocations, CPU use and exceptions. Use Worker metrics for this deployment; the zone overview's visitor number is not a reliable measure of app usage.
- [Cloud Logging](https://console.cloud.google.com/logs/query?project=travelguesser-woj-20260926): filter on `resource.type="cloud_run_revision" resource.labels.service_name="travelguesser" jsonPayload.component="tripguessr"`.

For a local aggregate report with your existing operator login:

```sh
PROJECT_ID=your-project-id node scripts/traffic-report.mjs --hours 24
```

The report reads only sanitized application records and aggregate native metrics. It prints no private trip links, profiles, photo data, search text, or network identifiers. Logs and metrics can take several minutes to arrive.

## What the numbers mean

**Requests are not people.** They include bots, health checks, files, live polling, retries, development verification and the owner. User-agent strings can be forged, so even browser-looking historical requests are not evidence of human visitors. No IP-based unique count, fingerprint or analytics identity is created.

The single `tripguessr_activity` counter has a fixed `activity` label:

| Activity | Meaning |
| --- | --- |
| `app_initializations` | Successful `/api/session` requests. Reloads, sign-in changes, tests and bots can count. |
| `creator_signins` | Successful creator session exchanges. Not unique accounts. |
| `trips_created` | Successful trip creation responses. |
| `solo_join_requests`, `solo_guess_requests` | Successful API operations, including retries/resumes. |
| `live_lobbies_created` | Successful explicit Host live operations. A lobby created together with a trip is counted under trip creation. |
| `live_join_requests`, `live_guess_requests` | Successful lobby operations, including retries/resumes. |

These counters begin with this deployment and are not backfilled. A blank chart may mean no samples, not zero. Neither returning players, unique people, exact completed-game counts, conversion funnels nor marketing attribution are claimed. The current database's trip/creator/run counts are operational records, not historical traffic analytics, and include retained demo/test activity.

The dashboard uses built-in Cloud Run metrics for all requests, including failures that never reach the application. Latency shows the **maximum p95 across revision and response-status series**; memory shows the maximum revision p95. Neither is an overall site-wide percentile. Firestore and storage charts are project/bucket totals; storage metrics can lag. The Firestore chart is not the provider's daily free-quota counter.

## Incidents and notifications

Four enabled policies record incidents:

- Public HTTPS fails from at least two check locations for five minutes (check cadence and ingestion add detection delay).
- At least three HTTP 5xx responses in a five-minute interval.
- At least ten HTTP 429 responses in a five-minute interval.
- A structured application error or crash. Notifications, if configured, are limited to one per 15 minutes for this policy.

**Private operator email alerts are enabled on all four policies.** Incidents also appear in the dashboard. The recipient is stored only in Cloud Monitoring and configured privately with `ALERT_EMAIL` when running the setup script. Never commit the address to the repository or publish it in the app. No runtime permission or service-account key is added.

The public health endpoint tests DNS/TLS, Cloudflare, Cloud Run and the web process. It intentionally does not write gameplay data or read a photo/database record every five minutes. Dependency failures are detected when application traffic exercises them. This is not a complete synthetic playthrough. Client JavaScript, maps or sign-in failures confined to a browser are not automatically reported; no browser error collector, session replay or third-party analytics script has been added.

## Logging and privacy

- Request records contain only fixed route names (such as `/api/games/:trip/live/:lobby`), an allowed HTTP method, status, duration and an optional fixed activity name. Raw unknown paths become `other`; assets become `/assets/*`.
- Abuse limits keep short-lived, per-process counters keyed by a randomly salted network-address hash. They are not analytics and are not persisted or included in logs.
- No request bodies, headers, IPs, referrers, user-agent strings, query parameters, credentials, creator/player identifiers, trip/lobby IDs, names, coordinates or photo contents are included in these application records.
- Error diagnostics keep a bounded error type/code and code file/line locations. Error messages, causes and dynamic function names are discarded. Runtime warnings are recorded at WARNING, crashes at CRITICAL. Third-party/runtime stderr and provider security/exception diagnostics are separate and may still include context; do not promise that every provider record is anonymous.
- After checking the replacement logs, the `_Default` sink excludes new `run.googleapis.com/requests` entries **only for this service**. This avoids storing the raw URL and IP in ordinary request history. The provider still processes a request before the storage exclusion applies. Built-in metrics, structured application logs, system logs and required audit logs remain.
- Existing raw Google request logs are not deleted by an exclusion; they age out under the existing 30-day retention. Structured/default logs also have 30-day retention. Required audit logs have 400-day retention. Aggregated Monitoring metrics follow Google's longer metric retention rules.
- Cloudflare logging remains enabled, but **Include Invocation logs is off**. Aggregate Worker metrics and exception logging remain available. The Free plan currently retains Worker logs for three days, so older invocation records can remain temporarily. Exception metadata and provider security processing may still contain network/request details.
- Authentication records, gameplay identifiers and third-party map requests continue to be used for their existing operational purposes, as described in the privacy notice. No extra visitor cookie or consent banner is introduced by these server-side counters.

## Investigating a problem

Start with the incident time, HTTP class and revision. Read sanitized warnings/errors and compare request latency, memory and dependency charts. Use the route template and code location to reproduce locally with a synthetic fixture. Avoid asking for or pasting cookies/tokens/private trip links into a public issue. Any temporary diagnostic logging should use the same field allowlist and have a removal plan.

During the initial audit, `MaxListenersExceededWarning` reproduced on successful Cloud Storage downloads in the Storage SDK / `teeny-request` stream pipeline. Two separate downloads both completed; this alone does not establish a growing application leak. It remains a dependency warning to monitor, not a fixed issue. Do not globally raise listener limits, suppress warnings or disable download integrity validation to hide it.

Unknown paths now return HTTP 404 instead of treating scanner probes as successful homepage responses. This corrects monitoring/HTTP semantics; it is not a bot firewall, and a 404 response alone is not evidence of a compromise.

## Cost and reproducibility

There is no new database, analytics subscription, sidecar or always-on instance. The runtime still scales to zero with a two-instance limit.

A three-location, five-minute check makes about **25,920 executions per 30-day month**, also adding about **864 Cloudflare/origin requests per day**. Google currently includes one million uptime executions per project/month. Native Google Cloud metrics are non-chargeable; the single bounded log counter uses the shared 150 MiB/month custom-metric allowance. Normal logs use the existing 50 GiB/project/month free allocation. At this site's current scale these monitoring components should fit the allowances, but origin processing/egress still follows Cloud Run pricing and account-wide metric allowances can be used by other projects. No hard spending cap is created.

Google currently says alerting charges start **no sooner than 1 September 2027**; review pricing before then. See [Google Observability pricing](https://cloud.google.com/products/observability/pricing), [Cloud Run metrics](https://docs.cloud.google.com/run/docs/monitoring), [Cloudflare Worker logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) and the [service cost report](COSTS-AND-LIMITS.md).

```sh
# Preview proposed configuration; no changes.
PROJECT_ID=your-project-id node scripts/configure-observability.mjs
# Create/reconcile the named metric, uptime check, policies and dashboard.
PROJECT_ID=your-project-id node scripts/configure-observability.mjs --apply
# Only after deploying and verifying sanitized records in Cloud Logging:
PROJECT_ID=your-project-id node scripts/configure-observability.mjs --apply --exclude-raw-logs
```

The script reuses existing resources by name. An existing alert recipient is preserved when `ALERT_EMAIL` is omitted. Cloudflare's matching configuration is in `cloudflare/wrangler.jsonc`; keep **invocation_logs=false** on future deployments. Monitor Cloudflare's account-wide 100,000 daily request ceiling in its dashboard; this setup does not alert on that separate provider quota.

## Live update release

SSE connections appear as the fixed `/api/games/:trip/live/:lobby/events` route and normally last up to 45 seconds. Their durations are expected and can dominate native request latency percentiles; they are not 45-second page loads. Inspect sanitized route-level logs for ordinary request latency. Draft and readiness requests have fixed route templates; shared-result tokens are redacted too. No coordinates or player identifiers are added to telemetry.

Watch billable instance time, memory, 429s, Firestore writes/reads and `live_stream_failed` / `live_transition_failed` errors. Browser reconnects count as requests; draft saves are not counted as confirmed guesses. Streams disconnect when hidden, removed, paused, expired or finished, with polling fallback. Admission is 60 streams/instance and 2/identity; high connection counts can still affect command latency. Load testing and cost assumptions are documented in COSTS-AND-LIMITS.md.

## Public trips

Aggregate activity labels also cover catalogue/daily requests, publication requests, public joins/guesses, and public friend-room creation/join/guess requests. They remain operation counts, not unique visitors or player profiles. Public IDs and report receipt tokens are replaced with fixed route templates; report bodies, optional emails, titles, source/answer manifests and guesses never enter application telemetry. Private email alerts for `report_received` and `daily_unavailable` reuse the existing notification channel. Inspect the private Admin inbox for report details; do not put those details in alert messages. Notification rate limits coalesce frequent reports, so inspect the inbox rather than treating email as an exhaustive queue.
