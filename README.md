# TravelGuesser

A photo guessing game for friends. Upload 1–12 trip photos, confirm their locations, and share an unlisted trip link. Friends enter a nickname, pin their guesses on a map, and compare distance-based scores.

[Play the live app](https://travelguesser-ysll6guxmq-lm.a.run.app) · [Try the demo](https://travelguesser-ysll6guxmq-lm.a.run.app/g/demo-trip)

GPS-tagged photos are located automatically. For other photos, search for a city, landmark, or address and choose a result to place the pin. You can adjust the pin on the map before publishing. Maps support dragging and scroll-wheel zoom. During a round, the photo fills the screen: scroll or use the photo controls to zoom, drag to pan, and use the overlaid map to guess. The map expands on hover or focus, with a size toggle for touch screens. Press Space to confirm a placed pin (the shortcut stays inactive while typing).

## Run locally

Requires Node.js 22.12+.

```sh
npm ci
npm run build
npm start
```

Open <http://localhost:8080>, click **Create a trip**, then **Continue locally**. This development identity works without cloud credentials and is disabled in production. `npm run dev` runs the React development server at port 5173 and the API at 8080. Local games and photos are saved in `.local/`; they survive server restarts.

```sh
npm test
```

The integration tests cover Google identity validation, CSRF protection, session expiry, owner isolation, concurrent upload quotas, interrupted upload cleanup, answer hiding, metadata stripping, scoring, persistence, and the demo.

## Deploy to Google Cloud

Choose a globally unique project ID and an accessible billing account. The default region is `europe-central2` (Warsaw); set `REGION` to choose another supported region.

The provisioning script creates/reuses the project, links the selected billing account, enables APIs, creates Firestore and a private Cloud Storage bucket, creates separate runtime/build identities, adds Firebase Authentication with Google sign-in, locks Firestore client access, and deploys the Docker image to Cloud Run. Firebase uses the same project and database; there is no additional database server.

```sh
gcloud auth login
PROJECT_ID=your-project-id BILLING_ACCOUNT=your-billing-account-id \
  SUPPORT_EMAIL=your-google-email bash scripts/deploy.sh
```

You need project creation, billing linking, and resource/IAM administration permissions. If the project already exists, it is reused. The script does not change your default gcloud project. The app uses Cloud Run's service account, with no downloaded service-account keys.

After deployment, `.local/service-url.txt` contains the public app URL. Anyone with a Google account can create trips. Each account can list and delete only its own trips. Friends receive `/g/<trip-id>` links and play without signing in. Firebase configuration and operator backups are saved in ignored `.local/` files. The browser Firebase API key is public client configuration, not a server credential; data access is protected by backend authorization and Firestore rules.

If you add a custom domain later, add it to Google sign-in’s allowed domains:

```sh
PROJECT_ID=your-project-id node scripts/configure-auth.mjs --domains https://your-domain.example
```

New IAM permissions can take a few minutes to propagate. If the first source build cannot read its source bundle, wait briefly and rerun the script; existing resources are reused.

`node scripts/smoke.mjs` verifies public access, the anonymous demo, scoring, and protected creator endpoints. `node scripts/smoke.mjs http://localhost:8080 --create` also creates and removes a temporary trip, testing uploads and two-player results. For that extended check against Google-auth deployments, supply a fresh Google Firebase ID token through `SMOKE_ID_TOKEN_FILE`; never commit tokens.

For an app-only redeploy after the initial setup:

```sh
gcloud run deploy travelguesser --source=. \
  --project=YOUR_PROJECT_ID --region=europe-central2 \
  --build-service-account=projects/YOUR_PROJECT_ID/serviceAccounts/travelguesser-build@YOUR_PROJECT_ID.iam.gserviceaccount.com --quiet
```

Cloud Run scales to zero, with a two-instance scaling limit at both service and revision level, 1 CPU, 1 GiB memory, and concurrency 4. Cloud Storage, Firestore, builds, image storage, logging, and requests may incur usage charges. There is no hard billing cap. Resources remain until removed from Google Cloud.

## Accounts, data, and limits

- Creators sign in with Google; Firebase Authentication stores their identity and last sign-in metadata. The app uses a five-day Secure, HttpOnly session cookie and does not store passwords or Google access tokens.
- Firestore stores trips, an owner UID and quota slots for each creator, and anonymous player runs/leaderboards. It does not duplicate email addresses or build a separate login-history database. Cloud Run is the only application client allowed to access it.
- Each creator can keep **5 active trips**, with **12 photos per trip** and at most **2 MiB per stored photo** (up to 120 MiB of current photos per creator). Upload slots are reserved transactionally before image processing; failed uploads are removed, and interrupted uploads/deletes are retried when the creator returns. Deleting a trip frees its slot after its photos are removed.
- Limits and request throttling reduce casual abuse; they are not a hard spending cap or a guarantee against many-account abuse. There is no automatic expiry of published trips. Cloud Storage soft-deleted objects may remain billable during the bucket’s retention period.
- There is no public trip directory. Anyone with a trip link can join; Google login is needed only for creating and managing trips.

For an existing installation, sign in once with the approved owner’s Google account, then migrate old trips. Dry-run first; `--apply` writes a private backup and preserves invite links, photos, and player results:

```sh
PROJECT_ID=your-project-id OWNER_EMAIL=your-google-email node scripts/migrate-trips.mjs
PROJECT_ID=your-project-id OWNER_EMAIL=your-google-email node scripts/migrate-trips.mjs --apply
```

Legacy host keys no longer grant access. The deployment removes the old `HOST_KEY` mapping.

## Design and behavior

- React + Vite frontend, Express backend, Leaflet with OpenStreetMap tiles.
- JPEG, PNG, and WebP uploads; up to 25 MB per original. Export HEIC to JPEG first.
- GPS is read from original EXIF data in the browser. Photos without GPS need a map pin or coordinates. Review all locations before publishing.
- Hosts can search place names and addresses through Photon, select a result to locate a photo, then adjust the map pin. Searches happen on button click or Enter, with caching, bounded queues, request spacing, timeouts, and host-only access. The public Photon service has no availability guarantee; maps and coordinate entry remain usable during search outages. Set `GEOCODING_URL` to a different Photon-compatible service if needed.
- The browser resizes photos; the server decodes, rotates, resizes, and re-encodes them again. EXIF and other metadata are removed. Original filenames and originals are not stored.
- Each correct location and reveal caption stays on the server until that round's guess is committed. Completed rounds cannot be changed. Firestore transactions protect scoring from concurrent submissions.
- Scores use `round(5000 × exp(-distanceKm / 1500))`; 5,000 points for an exact guess. Distance uses the haversine formula.
- A secure, HttpOnly browser cookie identifies each friend. Closing/reopening the page resumes the game. Clearing cookies or changing devices starts a new entry. This is a friendly game, not a cheat-proof competition.
- There is no public trip directory. Anyone with a trip link can play and see its photos; share links only with intended friends. Hosts can delete trips and their leaderboards.
- No Google Maps key, email delivery setup, or player accounts are required. OpenStreetMap tiles require internet access. In-memory request limits apply per server instance.

## Reference and asset credits

- [Cloud Run source deployment](https://docs.cloud.google.com/run/docs/deploying-source-code)
- [Firestore databases](https://docs.cloud.google.com/firestore/native/docs/manage-databases)
- [Sharp image metadata behavior](https://sharp.pixelplumbing.com/api-output/)
- [Leaflet](https://leafletjs.com/) and [OpenStreetMap](https://www.openstreetmap.org/copyright); follow the [tile usage policy](https://operations.osmfoundation.org/policies/tiles/) if scaling beyond a small friends-and-family app.
- [Photon place search](https://github.com/komoot/photon), backed by OpenStreetMap data. Search text is sent to the configured Photon service; images and host credentials are not sent to it.
- Landing and demo photography: [Unsplash](https://unsplash.com/license). Image IDs: `photo-1464822759023-fed622ff2c3b`, `photo-1502602898657-3e91760cbb34`, `photo-1506973035872-a4ec16b8e8d9`, `photo-1501594907352-04cda38ebc29`.
- DM Sans and Lora fonts from Google Fonts, served locally. Both are licensed under the SIL Open Font License; licenses are included in `public/fonts/`.
