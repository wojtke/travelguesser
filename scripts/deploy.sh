#!/usr/bin/env bash
set -euo pipefail

# Usage: PROJECT_ID=your-project BILLING_ACCOUNT=... SUPPORT_EMAIL=... bash scripts/deploy.sh
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
  gcloud projects create "$PROJECT_ID" --name=TripGuessr --quiet
LINKED_BILLING="$(gcloud billing projects describe "$PROJECT_ID" --format='value(billingAccountName)' 2>/dev/null || true)"
if [[ "$LINKED_BILLING" != "billingAccounts/${BILLING_ACCOUNT}" ]]; then
  gcloud billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT" --quiet
fi
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  firestore.googleapis.com storage.googleapis.com iam.googleapis.com \
  firebase.googleapis.com identitytoolkit.googleapis.com apikeys.googleapis.com firebaserules.googleapis.com \
  --project="$PROJECT_ID" --quiet

gcloud firestore databases describe --database='(default)' --project="$PROJECT_ID" >/dev/null 2>&1 ||
  gcloud firestore databases create --database='(default)' --location="$REGION" --type=firestore-native --project="$PROJECT_ID" --quiet
# Nested live players/guesses and photo coordinates are never queried by value.
# Exempt them to avoid indexing every player identifier and result.
for FIELD in live photos; do
  gcloud firestore indexes fields update "$FIELD" --collection-group=games --disable-indexes --project="$PROJECT_ID" --quiet
done
# Only demo documents carry this TTL field; uploaded trips do not expire.
for COLLECTION in runs leaderboard; do
  gcloud firestore fields ttls update demoExpiresAt --collection-group="$COLLECTION" --enable-ttl --async --project="$PROJECT_ID" --quiet
done
gcloud storage buckets describe "gs://${BUCKET}" --project="$PROJECT_ID" >/dev/null 2>&1 ||
  gcloud storage buckets create "gs://${BUCKET}" --location="$REGION" --uniform-bucket-level-access --public-access-prevention --project="$PROJECT_ID" --quiet

for SA_NAME in travelguesser-runtime travelguesser-build; do
  gcloud iam service-accounts describe "${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" --project="$PROJECT_ID" >/dev/null 2>&1 ||
    gcloud iam service-accounts create "$SA_NAME" --project="$PROJECT_ID" --quiet
done
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${RUNTIME_SA}" --role=roles/datastore.user --condition=None --quiet >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" --member="serviceAccount:${RUNTIME_SA}" --role=roles/storage.objectUser --project="$PROJECT_ID" --quiet >/dev/null
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${BUILD_SA}" --role=roles/run.builder --condition=None --quiet >/dev/null

gcloud iam roles describe travelguesserSessionManager --project="$PROJECT_ID" >/dev/null 2>&1 ||
  gcloud iam roles create travelguesserSessionManager --project="$PROJECT_ID" \
  --title='TripGuessr session manager' --permissions=firebaseauth.users.get,firebaseauth.users.createSession --stage=GA --quiet
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${RUNTIME_SA}" \
  --role="projects/${PROJECT_ID}/roles/travelguesserSessionManager" --condition=None --quiet >/dev/null

export PROJECT_ID
node scripts/configure-auth.mjs
node --input-type=module - <<'JS'
import {spawnSync} from 'node:child_process';
import {accessToken} from './scripts/admin-cloud.mjs';
const result=spawnSync('npm',['exec','--yes','--package=firebase-tools@15.31.0','--','firebase','deploy','--only','firestore:rules','--project',process.env.PROJECT_ID,'--non-interactive'],{env:{...process.env,FIREBASE_TOKEN:accessToken(),GOOGLE_CLOUD_QUOTA_PROJECT:process.env.PROJECT_ID},stdio:'inherit'});
process.exitCode=result.status;
JS

gcloud run deploy "$SERVICE" --source=. --region="$REGION" --project="$PROJECT_ID" \
  --service-account="$RUNTIME_SA" \
  --build-service-account="projects/${PROJECT_ID}/serviceAccounts/${BUILD_SA}" \
  --env-vars-file=.local/runtime-env.json --remove-secrets=HOST_KEY \
  --allow-unauthenticated --port=8080 --memory=1Gi --cpu=1 --concurrency=4 \
  --min-instances=0 --max-instances=2 --max=2 --timeout=60 --cpu-throttling --quiet

gcloud run services describe "$SERVICE" --region="$REGION" --project="$PROJECT_ID" --format='value(status.url)' > .local/service-url.txt
SERVICE_URL="$(cat .local/service-url.txt)"
node scripts/configure-auth.mjs --domains "$SERVICE_URL"
echo "TripGuessr is live at ${SERVICE_URL}. Anyone can sign in with Google to create trips."
