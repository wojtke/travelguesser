#!/usr/bin/env bash
set -euo pipefail

# Usage: PROJECT_ID=your-project BILLING_ACCOUNT=xxxxxx-xxxxxx-xxxxxx bash scripts/deploy.sh
# Existing resources are reused. Every gcloud command explicitly selects the project.
PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID to your Google Cloud project ID}"
REGION="${REGION:-europe-central2}"
SERVICE="travelguesser"
BUCKET="${PROJECT_ID}-photos"
RUNTIME_SA="travelguesser-runtime@${PROJECT_ID}.iam.gserviceaccount.com"
BUILD_SA="travelguesser-build@${PROJECT_ID}.iam.gserviceaccount.com"

if [[ -z "${BILLING_ACCOUNT:-}" ]]; then
  echo 'Set BILLING_ACCOUNT to the billing account you want to use.' >&2
  exit 1
fi

gcloud projects describe "$PROJECT_ID" --format='value(projectId)' >/dev/null 2>&1 ||
  gcloud projects create "$PROJECT_ID" --name=TravelGuesser --quiet
LINKED_BILLING="$(gcloud billing projects describe "$PROJECT_ID" --format='value(billingAccountName)' 2>/dev/null || true)"
if [[ "$LINKED_BILLING" != "billingAccounts/${BILLING_ACCOUNT}" ]]; then
  gcloud billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT" --quiet
fi
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  firestore.googleapis.com storage.googleapis.com secretmanager.googleapis.com iam.googleapis.com \
  --project="$PROJECT_ID" --quiet

gcloud firestore databases describe --database='(default)' --project="$PROJECT_ID" >/dev/null 2>&1 ||
  gcloud firestore databases create --database='(default)' --location="$REGION" --type=firestore-native --project="$PROJECT_ID" --quiet
gcloud storage buckets describe "gs://${BUCKET}" --project="$PROJECT_ID" >/dev/null 2>&1 ||
  gcloud storage buckets create "gs://${BUCKET}" --location="$REGION" --uniform-bucket-level-access --public-access-prevention --project="$PROJECT_ID" --quiet

for SA_NAME in travelguesser-runtime travelguesser-build; do
  gcloud iam service-accounts describe "${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" --project="$PROJECT_ID" >/dev/null 2>&1 ||
    gcloud iam service-accounts create "$SA_NAME" --project="$PROJECT_ID" --quiet
done
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${RUNTIME_SA}" --role=roles/datastore.user --condition=None --quiet >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" --member="serviceAccount:${RUNTIME_SA}" --role=roles/storage.objectUser --project="$PROJECT_ID" --quiet >/dev/null
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${BUILD_SA}" --role=roles/run.builder --condition=None --quiet >/dev/null

mkdir -p .local
chmod 700 .local
if ! gcloud secrets describe host-key --project="$PROJECT_ID" >/dev/null 2>&1; then
  node --input-type=module -e 'import{randomBytes}from"node:crypto";import{writeFileSync}from"node:fs";writeFileSync(".local/host-key.txt",randomBytes(32).toString("base64url"),{mode:0o600});'
  gcloud secrets create host-key --data-file=.local/host-key.txt --replication-policy=automatic --project="$PROJECT_ID" --quiet
fi
gcloud secrets add-iam-policy-binding host-key --member="serviceAccount:${RUNTIME_SA}" --role=roles/secretmanager.secretAccessor --project="$PROJECT_ID" --quiet >/dev/null

gcloud run deploy "$SERVICE" --source=. --region="$REGION" --project="$PROJECT_ID" \
  --service-account="$RUNTIME_SA" \
  --build-service-account="projects/${PROJECT_ID}/serviceAccounts/${BUILD_SA}" \
  --set-env-vars="DATA_BACKEND=gcp,GOOGLE_CLOUD_PROJECT=${PROJECT_ID},PHOTO_BUCKET=${BUCKET}" \
  --set-secrets=HOST_KEY=host-key:latest \
  --allow-unauthenticated --port=8080 --memory=1Gi --cpu=1 --concurrency=4 \
  --min-instances=0 --max-instances=2 --timeout=60 --cpu-throttling --quiet

gcloud run services describe "$SERVICE" --region="$REGION" --project="$PROJECT_ID" --format='value(status.url)' > .local/service-url.txt
gcloud secrets versions access latest --secret=host-key --project="$PROJECT_ID" > .local/host-key.txt
chmod 600 .local/host-key.txt
node --input-type=module - <<'JS'
import {readFileSync,writeFileSync} from 'node:fs';
const url=readFileSync('.local/service-url.txt','utf8').trim();
const key=readFileSync('.local/host-key.txt','utf8').trim();
writeFileSync('.local/host-access.md',`# TravelGuesser host access\n\n[Open your private host link](${url}/create#host=${key})\n\nKeep this link private. It grants access to create and delete trips.\nShare each trip’s invite link with your friends instead.\n\nHost key: \`${key}\`\n`,{mode:0o600});
console.log(`TravelGuesser is live at ${url}\nPrivate host link saved to .local/host-access.md`);
JS
