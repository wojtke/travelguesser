#!/usr/bin/env bash
# Called only after the checked commit's container is built and pushed.
set -Eeuo pipefail
: "${GCP_PROJECT_ID:?}" "${GCP_REGION:?}" "${CLOUD_RUN_SERVICE:?}" "${DEPLOY_IMAGE:?}" "${PUBLIC_URL:?}"
: "${GITHUB_SHA:?}" "${GITHUB_RUN_ID:?}" "${GITHUB_RUN_ATTEMPT:?}" "${GITHUB_REPOSITORY:?}"

# A newer commit may have arrived while this job built its image.
CURRENT_HEAD="$(gh api "repos/${GITHUB_REPOSITORY}/commits/main" --jq .sha)"
if [[ "$CURRENT_HEAD" != "$GITHUB_SHA" ]]; then
  echo 'A newer main commit exists; skipping this superseded deployment.'
  exit 0
fi

SERVICE_STATE="$(gcloud run services describe "$CLOUD_RUN_SERVICE" --project="$GCP_PROJECT_ID" --region="$GCP_REGION" --format=json)"
PREVIOUS_TRAFFIC="$(jq -r '[.status.traffic[] | select(.percent > 0) | .revisionName + "=" + (.percent | tostring)] | join(",")' <<< "$SERVICE_STATE")"
ORIGIN_URL="$(jq -r .status.url <<< "$SERVICE_STATE")"
REVISION_SUFFIX="gh-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
DEPLOYED_REVISION="${CLOUD_RUN_SERVICE}-${REVISION_SUFFIX}"

rollback() {
  local failure_code=$?
  trap - ERR
  local traffic
  traffic="$(gcloud run services describe "$CLOUD_RUN_SERVICE" --project="$GCP_PROJECT_ID" --region="$GCP_REGION" --format=json)" || exit "$failure_code"
  # Do not overwrite a separate operator's subsequent traffic change.
  if [[ -n "$PREVIOUS_TRAFFIC" ]] && jq -e --arg revision "$DEPLOYED_REVISION" '[.status.traffic[] | select(.percent > 0)] | length == 1 and .[0].revisionName == $revision' <<< "$traffic" >/dev/null; then
    echo 'Deployment verification failed; restoring the previous traffic allocation.'
    gcloud run services update-traffic "$CLOUD_RUN_SERVICE" --project="$GCP_PROJECT_ID" --region="$GCP_REGION" --to-revisions="$PREVIOUS_TRAFFIC" --quiet || true
  fi
  exit "$failure_code"
}
trap rollback ERR

gcloud run deploy "$CLOUD_RUN_SERVICE" --image="$DEPLOY_IMAGE" \
  --project="$GCP_PROJECT_ID" --region="$GCP_REGION" \
  --no-traffic --revision-suffix="$REVISION_SUFFIX" --labels="commit-sha=${GITHUB_SHA},managed-by=github-actions" --quiet
# Explicit promotion also works after an earlier rollback pinned traffic to an old revision.
gcloud run services update-traffic "$CLOUD_RUN_SERVICE" --project="$GCP_PROJECT_ID" \
  --region="$GCP_REGION" --to-revisions="${DEPLOYED_REVISION}=100" --quiet
node scripts/check-release.mjs "$ORIGIN_URL" "$PUBLIC_URL"
trap - ERR
{
  echo '### Production deployment'
  echo "Commit: ${GITHUB_SHA}"
  echo "Revision: ${DEPLOYED_REVISION}"
  echo "Site: ${PUBLIC_URL}"
  echo 'Origin and public-domain health, homepage and JavaScript checks passed.'
} >> "$GITHUB_STEP_SUMMARY"
