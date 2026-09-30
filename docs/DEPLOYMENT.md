# Automatic deployments

Configured 29 September 2026. `.github/workflows/ci.yml` runs checks for pushes and pull requests. Only a successful `main` push, or a manual **Run workflow** on `main`, can deploy. Pull requests (including forks) receive no Google deployment permissions. A failed check leaves production unchanged.

The deploy job builds the existing Dockerfile on a GitHub-hosted Linux runner, before authenticating to Google. It pushes a commit-tagged image to `europe-central2-docker.pkg.dev/travelguesser-woj-20260926/cloud-run-source-deploy/travelguesser` and deploys its immutable digest. This does not invoke a second Google Cloud Build. There is no new hosting service or paid plan. Normal Artifact Registry storage and Cloud Run usage still apply; the existing min-zero/max-two-instance configuration and runtime settings are preserved. Builds depend on upstream package/container availability.

The production job is serialized and checks whether its commit is still the current `main` before building and immediately before deploying. It creates a ready revision without traffic, promotes that revision, and checks the origin and `https://tripguessr.com` for health, homepage HTML and a loadable JavaScript bundle. The Cloudflare Worker continues to forward to the same service; ordinary app releases do not redeploy it. Revision names contain the GitHub run ID/attempt, and the service carries the commit SHA label.

With public features enabled, release checks also require an official-trip fallback and validate the daily API's current UTC date, reset time, five-photo/60-second metadata and absence of private answer fields. An explicit `trip: null` is the supported degraded state: the check emits a GitHub warning and records **DEGRADED** in the job summary, but permits deployment while official trips remain available. This allows a safe release after content withdrawal without rolling back unrelated fixes. Missing/malformed metadata, stale dates or an unavailable official fallback fail verification and trigger the normal rollback path. Investigate degraded warnings through Admin and the private daily-unavailable alert.

## Credentials and permissions

[Google Workload Identity Federation](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines) exchanges GitHub OIDC identity for short-lived deployment credentials. Pool `tripguessr-github`, provider `github`, trusts only:

- Repository numeric ID `1389486979` and owner numeric ID `53000695`.
- `refs/heads/main`, with event `push` or `workflow_dispatch`.
- `wojtke/travelguesser/.github/workflows/ci.yml@refs/heads/main`.

`tripguessr-github-deploy` has Cloud Run Developer on the **existing service**, Artifact Registry Writer on the **existing image repository**, Service Account User on the **existing runtime identity**, and Service Usage Consumer for the project. The external GitHub principal can impersonate only this deployer through `roles/iam.workloadIdentityUser`. It has no direct database/photo-storage role and cannot administer IAM. As with any deployer, permission to deploy code under the runtime identity indirectly permits using that application's runtime access; protect writes to `main` accordingly. This setup does not claim to enforce branch review rules.

Only the deployment job has GitHub `id-token: write`; other jobs have `contents: read`. Actions are pinned to commit SHAs. Generated `gha-creds-*.json` files are excluded from Git and both build contexts. The image is built before credentials are generated. Project/provider/service identifiers are ordinary repository variables, not credentials.

One-time setup/reconciliation with the operator's existing `gh` and `gcloud` logins:

```sh
PROJECT_ID=travelguesser-woj-20260926 DEPLOY_REPOSITORY=wojtke/travelguesser node scripts/configure-ci.mjs
# Preview the exact resource scopes and OIDC condition, then apply:
PROJECT_ID=travelguesser-woj-20260926 DEPLOY_REPOSITORY=wojtke/travelguesser node scripts/configure-ci.mjs --apply
```

The setup script creates/reuses the dedicated identity/pool/provider, adds scoped IAM bindings and sets repository variables. It does not grant project Owner/Editor or create a long-lived key. Do not remove the numeric repository/owner restrictions when renaming/moving the repository; review and reconcile them deliberately.

## Failures and rollback

A build/authentication failure leaves the current revision serving. A post-promotion health failure makes the workflow fail and attempts to restore the previous traffic allocation, provided the deployed revision is still the sole serving revision. An operator's later traffic change is not overwritten. Rollback failure remains visible in job output; automatic rollback is not a substitute for monitoring. A healthy `/api/health` does not prove all gameplay/database paths work; emulator/browser checks and existing runtime error alerts remain important.

Inspect the **Deploy production** job and its summary in [Actions](https://github.com/wojtke/travelguesser/actions/workflows/ci.yml). To roll back manually, first identify the last good revision in Cloud Run, then:

```sh
gcloud run services update-traffic travelguesser \
  --project=travelguesser-woj-20260926 --region=europe-central2 \
  --to-revisions=KNOWN_GOOD_REVISION=100
```

Revert the bad commit on `main` so the next automatic release contains the fix. For emergency maintenance, disable the workflow or remove the deployment trust before a temporary manual rollback; another successful `main` run otherwise promotes its own revision. The next successful pipeline explicitly promotes its new revision even after traffic was pinned by a rollback.

Infrastructure provisioning, database migrations, Firebase configuration, TTL policies, budgets and Cloudflare Worker changes remain explicit operator operations. Ordinary app releases do not rerun the provisioning script or migrations.

## Public feature rollout

See [PUBLIC-TRIPS.md](PUBLIC-TRIPS.md) for additive Firestore index/TTL setup, reviewed photo seeding, the UID allowlist and the production `PUBLIC_TRIPS_ENABLED` flag. The ordinary CI deployment preserves existing environment settings and still promotes only after health checks. Keep candidate/provenance manifests, private operator identifiers and future daily answers out of Git. Public trip publication requires creator opt-in; no migration publishes existing user trips.
