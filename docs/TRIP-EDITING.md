# Editing trips

Added after the screenshot feedback on 30 September 2026. Use **My trips → Edit trip** to change the title, host nickname, captions, coordinates, timer/game defaults, photo order, and uploaded photos. Saving preserves the trip ID, link, ownership, creation date and sharing state. Editing is available even when all five creator slots are full. Only new files are uploaded; existing photos reuse their private object keys.

## My trips and owner previews

My trips uses one row per trip, with a stack of up to three photos, a photo count, creation date and explicit link-sharing status. Edit, copy the trip link, and host/open a live lobby are the main actions. Paused trips offer **Enable sharing** in place of copying a link. **More options** expands inline for opening the trip, public sharing, pausing link sharing and deletion (still confirmed in a dialog). These controls wrap for tablet/mobile and are keyboard accessible.

Live setup uses a dedicated 640px, single-column modal variant for both owned trips and public friend rooms. The earlier two-column fieldset inside a 460px modal squeezed controls, and inherited text-input padding shortened the slider track. Timer inputs now place the exact seconds field above a full-width track with logarithmic spacing (`log(seconds) / log(3600)`); endpoints remain 1 and 3600 seconds. Native keyboard handling is overridden for one-second arrows so rounding cannot trap the thumb at short durations. Browser tests cover mouse clicks and dragging to both ends, keyboard/manual values, submission validation, and 320px–1440px layouts.

The stack requests only the first three owner editor photos with `thumbnail=1`. The server checks creator ownership and the current revision before reading or resizing media. It returns fixed 240×160 JPEG previews, strips metadata, and sets `private, no-store`. Anonymous guests and other signed-in creators cannot fetch them, even after joining a trip. Public trip/catalog responses gain no previews or photo references. Browsers lazy-load the images; a failed image shows a camera placeholder without breaking the controls.

Previews are generated from the existing private object on demand, with no additional stored files, database fields, background jobs or services. Each preview still incurs the usual authenticated request, trip read and photo-object read; up to 15 small preview responses can load for a five-trip owner list. This trades a small bounded amount of resizing work for less browser bandwidth and avoids a public image cache. Revision URLs prevent showing a reordered photo under an old revision. API and browser regression tests cover authorization, metadata stripping, size limits, stale revisions, sharing controls and layouts down to 320px.

## Existing games and public editions

Changes apply to new playthroughs and new lobbies. Each new solo run and live lobby stores a private snapshot of its title, photos, locations and rules. On the first edit, `originalTrip` preserves the original configuration for older runs/lobbies without a snapshot. This avoids a bulk migration. Returning players retain their saved playthrough, including completed results. Solo leaderboard responses select that playthrough's trip revision; a new visitor sees the latest revision's scores. The leaderboard scan remains bounded to 100 candidates rather than scanning all historical results.

Public editions are separate immutable snapshots. Editing the source changes neither their photos nor their rankings. Unpublishing and republishing an existing edition restores the same edition, not an updated one. To publish a different public edition, create a new source trip. Public sharing and sharing-pause controls keep their existing behavior. Existing live lobbies keep their original photo order and rules even if the creator edits their source during the session.

## Storage and atomic saves

Each trip retains a maximum of **24 MiB** of processed media across its current photos and earlier edits (12 × 2 MiB), within the existing five-trip allowance. Removed photos remain private and available to earlier games/public editions until the entire trip is deleted. The editor and privacy notice explain this. Metadata-only edits need no extra photo storage. No original filenames or uploaded metadata are retained.

A multipart save accepts either an existing photo key from this trip or a unique upload index. Owner and CSRF checks run before multipart parsing; the existing upload rate and concurrency limits apply. New files are re-encoded with the same size/pixel limits and metadata removal as creation. The server generates unpredictable, unique object keys.

The database transaction reserves media bytes in both the trip and creator quota records before saving objects. A second transaction checks the editor's `tripRevision` and upload token, preserves the legacy snapshot, and replaces the current configuration. Competing saves cannot overwrite each other. Failed saves delete only their own new keys and release their reservation; cleanup first claims the reservation to prevent a racing commit. If interrupted, reservations older than 15 minutes are recovered on the next authenticated editor load/save. Earlier gameplay/public media is never removed by edit rollback.

## Troubleshooting

- **Changed in another window:** keep a copy of unsaved text, then reload the editor to fetch the current revision. The server deliberately rejects the stale save.
- **Another save in progress / upload throttled:** wait for the other save to finish. An interrupted save recovers after its 15-minute reservation expires; opening the editor triggers recovery.
- **24 MB photo limit:** earlier media still supports existing games. Text, coordinate and ordering edits remain possible; use a new trip for additional photos. Deleting the whole trip follows the normal media/database deletion path.
- **A returning player sees old photos:** this is their saved playthrough. New players and new lobbies use the edited version; public editions remain fixed.
- **Editor cannot load a photo:** check the owner session and revision. Owner preview URLs check the current revision and bypass solo shuffle/progression; they never expose arbitrary object keys.
- **Cleanup failures:** inspect the sanitized `edit_cleanup_failed` event. Do not log private paths, captions, coordinates, tokens or request bodies. Use authenticated editor recovery before considering manual cleanup.

## Screenshot fixes and checks

The accompanying UI change adds padding to My public scores, predictable spacing/wrapping for trip and result actions, consistent round-card/map alignment, and an explicit map legend. Results maps can fit very distant pins, including across the date line and in short mini-maps. Resize observation reapplies the result bounds. Below zoom zero, Leaflet scales the existing zoom-zero tile; it does not request negative-zoom URLs.

Regression coverage includes owner/CSRF isolation, invalid media references, legacy/current playthrough preservation, immutable public/live content, full-slot editing, stale editors, interrupted uploads, media quotas, and concurrent Firestore saves from separate store instances. Browser coverage edits and reloads a real synthetic trip, validates missing coordinates and unsaved-navigation protection, and checks desktop/tablet/mobile layouts and pin containment. Tests stub public map tiles and do not mutate production trips or scores.
