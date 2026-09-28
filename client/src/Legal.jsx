const operator = <>Wojciech Jasiński, based in Poland.</>;
export default function Legal({ page }) {
  return (
    <main className="legal-page">
      <a className="back-link" href="/">
        ← Back to TripGuessr
      </a>
      <h1>
        {page === 'privacy'
          ? 'Privacy notice'
          : page === 'terms'
            ? 'Terms of use'
            : 'Cookies and browser storage'}
      </h1>
      <p className="small-note">Effective 28 September 2026</p>
      {page === 'privacy' ? (
        <>
          <h2>Who operates TripGuessr</h2>
          <p>
            The controller of personal data processed to operate this service is {operator} This
            notice covers tripguessr.com and its TripGuessr Cloud Run service.
          </p>
          <h2>What we collect and why</h2>
          <ul>
            <li>
              <strong>Creators:</strong> Google account ID, email address and basic profile, plus
              account and sign-in timestamps. Google/Firebase may retain the profile image supplied
              by Google. We use this to sign you in, assign ownership and let you manage your trips.
              Your email is not shown to players.
            </li>
            <li>
              <strong>Trips:</strong> title, chosen host name, photos, captions and the location
              assigned to each photo. If present, photo GPS metadata is read in your browser to set
              the pin. Resized photos are uploaded and re-encoded on the server without the original
              metadata. Coordinates are stored separately to score guesses. No device location
              permission is requested.
            </li>
            <li>
              <strong>Players:</strong> chosen nickname, random browser identifier, guesses, scores
              and game timestamps. These keep your progress and make solo games and live lobbies
              work. Players do not need a Google account.
            </li>
            <li>
              <strong>Operations:</strong> our application records the route category (with trip and
              lobby identifiers removed), HTTP method, response status, processing time and limited
              code diagnostics. We count successful operations such as opening the app, creating
              trips and submitting guesses. These are aggregate activity counts, not unique visitor
              profiles. We do not add analytics cookies, fingerprint browsers or include IP
              addresses, emails, account/player IDs, private links, search text, request bodies or
              photo data in these application records. To limit abuse, the server also keeps
              short-lived request counters in memory, keyed by a salted hash of the network address.
              These counters are not stored in the database or used for analytics. Hosting, map and
              sign-in providers still process network information such as IP addresses to deliver
              and protect their services, and may retain security or exception diagnostics under
              their policies. Avoid putting personal information in trip titles, nicknames or place
              searches.
            </li>
          </ul>
          <p>
            Account and gameplay processing is necessary to provide the service you request (GDPR
            Article 6(1)(b)). Security, abuse prevention, responding to reports and protecting the
            rights of people in uploaded photos rely on legitimate interests (Article 6(1)(f)).
            Where applicable, we process information to meet a legal obligation (Article 6(1)(c)).
            We do not sell personal data, run advertising or use it for marketing. We do not make
            automated decisions with legal or similarly significant effects; game scoring is
            automatic.
          </p>
          <h2>Who can see a trip</h2>
          <p>
            Trips are link-only. There is no public trip directory. Anyone who receives the link can
            enter, see the photos and, through gameplay, see their locations and captions. Links may
            be forwarded. Solo leaderboards show nicknames and scores; live participants and the
            host see group nicknames, guesses, distances and scores after each reveal. Choose a
            nickname you are comfortable sharing.
          </p>
          <p>
            Trip pages and photo/API responses tell cooperating search engines not to index them.
            This is not password protection or a guarantee of secrecy. People can save or screenshot
            content. Creators can pause sharing or delete a trip in My trips. Pausing ends an active
            live session and blocks other people’s subsequent access; it cannot erase copies already
            saved.
          </p>
          <p>
            If someone uploads a photo of you, the uploader is the source. We use it only to provide
            the trip and handle requests concerning it.
          </p>
          <h2>Service providers and international processing</h2>
          <p>
            Google Cloud runs the application, Firestore database and private photo storage in
            Warsaw (europe-central2). Firebase/Google provides creator authentication. Cloudflare
            provides domain routing, HTTPS and the proxy in front of the app. Authentication,
            delivery, support and security processing may take place outside Poland and the EEA;
            choosing a Warsaw database does not make every part of the service EU-only.
          </p>
          <p>
            Google and Cloudflare describe their processing and international-transfer safeguards,
            including applicable standard contractual clauses, in their{' '}
            <a href="https://cloud.google.com/terms/data-processing-addendum">
              Google Cloud data processing terms
            </a>
            , <a href="https://firebase.google.com/support/privacy">Firebase privacy information</a>{' '}
            and{' '}
            <a href="https://www.cloudflare.com/cloudflare-customer-dpa/">
              Cloudflare data processing addendum
            </a>
            .
          </p>
          <p>
            Maps load directly from OpenStreetMap, which receives your IP address, browser
            information and the map tiles requested. This can indicate the map area you view. See
            the{' '}
            <a href="https://osmfoundation.org/wiki/Privacy_Policy">
              OpenStreetMap Foundation privacy policy
            </a>
            . When a creator submits a place search, the search text is sent through our server to
            the public Photon service at photon.komoot.io. We do not send it your account details,
            cookies or photos. These external services have their own operational logging.
          </p>
          <h2>Saved guesses and shared results</h2>
          <p>
            During a live round we save your current map pin so it can count if time runs out.
            Unconfirmed pins are private to your browser identity until the round is revealed. Round
            results include nicknames, points, distances and guessing time. Choosing “Share my
            results” creates a separate link containing your nickname, trip title, scores, distances
            and timing, without photos, coordinates, captions or other players’ results. Anyone with
            that link can view it. Pausing or deleting the trip blocks it.
          </p>
          <h2>How long data stays</h2>
          <p>
            Trips, uploaded photos, solo scores and stored lobby state remain until the creator
            deletes the trip or we remove it following a valid request or abuse report. Saved live
            pins expire with the 24-hour lobby. Shared result snapshots expire after 30 days,
            including if the host has since opened a new lobby. Expired pins and snapshots are
            queued for automatic database deletion, normally within another 24 hours. A live link
            expires 24 hours after creation; expiry blocks access, but is not automatic data
            deletion. Opening a new lobby replaces the previous lobby’s state. Creator account
            records remain until account deletion is requested. Demo progress and demo scores expire
            after 30 days. Expired demo records are hidden immediately and queued for automatic
            database deletion, which normally completes within another 24 hours.
          </p>
          <p>
            Deleting a trip removes its active database records and photos. Cloud Storage retains
            soft-deleted photos for seven additional days before permanent removal. Google Cloud
            application logs are retained for 30 days and required audit logs for 400 days. Routine
            raw Cloud Run request logs are excluded from new storage once the sanitized logging
            configuration is enabled; older entries can contain IP addresses and private URLs until
            their 30-day retention expires. Cloudflare routine invocation logs are disabled;
            exception diagnostics and authentication/security records remain subject to provider
            policies. Aggregate monitoring metrics may be kept longer under Google Cloud Monitoring
            retention rules. These records may outlast trip deletion. A limited record may be
            retained where required by law or needed for a specific dispute. Browser cookie periods
            are listed in the <a href="/cookies">cookie notice</a>.
          </p>
          <h2>Your choices and rights</h2>
          <p>
            Delete your trips or pause their sharing from My trips. You may request account
            deletion, a copy of your data, corrections, objections to processing based on legitimate
            interests, restriction, erasure or portability where applicable. For anonymous gameplay,
            use the same browser if possible; we may need proportionate information to verify that a
            request concerns your data. Never share your password or sign-in cookies.
          </p>
          <p>
            We respond to rights requests within one month. If an extension is permitted and
            necessary, we explain why within that month. You can complain to the{' '}
            <a href="https://uodo.gov.pl/en/681/1404">
              President of Poland’s Personal Data Protection Office (UODO)
            </a>{' '}
            or the supervisory authority where you live or work in the EEA. Providing account/game
            data is voluntary, but the relevant features cannot work without it. TripGuessr is
            intended for people aged 16 or over.
          </p>
          <h2>Changes</h2>
          <p>
            We update the date above when this notice changes and provide an appropriate notice for
            significant changes.
          </p>
        </>
      ) : page === 'terms' ? (
        <>
          <h2>The service</h2>
          <p>
            TripGuessr is a free photo location guessing game operated by {operator} Creators sign
            in with Google; friends can play using a trip link and a nickname. You must be at least
            16 to use the service.
          </p>
          <h2>Your photos and links</h2>
          <p>
            You keep ownership of your photos. By uploading them, you give us permission to store,
            resize and display them to people accessing your trip, solely to operate the service.
            Only upload material you have the right to share, including permission where needed from
            people shown in it. Do not upload unlawful, abusive or intimate material, or expose
            someone’s home or other sensitive location without permission.
          </p>
          <p>
            Trips are link-only, not confidential vaults. Anyone with a link can forward it and save
            content. Search-engine exclusion cannot prevent this. You control sharing and can delete
            your trips from My trips. Do not post links publicly if the photos are private.
          </p>
          <h2>Fair use and limits</h2>
          <p>
            Current limits are 5 trips per creator, 12 photos per trip, 2 MB per stored photo and 20
            players per live lobby. Live links expire after 24 hours. We may change limits or
            restrict access to prevent abuse, meet provider requirements or keep costs manageable.
            Do not scrape private trips, bypass access controls, bulk-download map tiles, upload
            malware or deliberately overload the service.
          </p>
          <h2>Availability and removal</h2>
          <p>
            This is a small independent service with no guaranteed uptime or permanent storage. Keep
            your original photos. Maps, place search or hosting can be interrupted, including when a
            provider’s free limit is reached. We may remove unlawful content or suspend abusive use,
            and will explain the reason where appropriate and legally permitted. You can challenge a
            removal or restriction.
          </p>
          <p>
            You can stop using the service at any time, delete your trips, and request account
            deletion. If the service closes, we will aim to provide advance notice and an
            opportunity to retrieve your data. Nothing in these terms excludes rights or liability
            that cannot lawfully be excluded.
          </p>
          <h2>Reports, complaints and privacy</h2>
          <p>
            Reports should identify the relevant trip and describe the problem. Avoid including
            unnecessary personal data. We review privacy, copyright, illegal-content and service
            complaints and respond as appropriate. Personal data handling is described in our{' '}
            <a href="/privacy">Privacy notice</a> and <a href="/cookies">cookie notice</a>.
          </p>
          <p>
            Polish law applies, without taking away mandatory protections available to consumers in
            their country of residence. Material changes will be announced appropriately; the
            current version’s date appears above.
          </p>
        </>
      ) : (
        <>
          <h2>Storage used to run the game</h2>
          <p>
            TripGuessr uses first-party cookies for browser identity, sign-in and request security.
            We do not add advertising cookies or analytics trackers.
          </p>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Purpose</th>
                <th>Lifetime</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>tg_player</td>
                <td>
                  Random identifier that reconnects this browser to its guesses and live lobby.
                </td>
                <td>30 days</td>
              </tr>
              <tr>
                <td>tg_csrf</td>
                <td>Protects actions against forged cross-site requests.</td>
                <td>30 days</td>
              </tr>
              <tr>
                <td>tg_creator</td>
                <td>Keeps a creator signed in.</td>
                <td>5 days; removed on sign-out</td>
              </tr>
            </tbody>
          </table>
          <p>
            The tg_countdown_sound local-storage preference remembers whether you muted the
            final-five-second ticks, until you clear browser storage. It is not sent to our server.
            We do not persist optional name preferences in local storage. Older tg_player_name and
            tg_host_name entries are removed when this version loads. Your nickname remains part of
            the server-side game record. Google sign-in uses temporary Firebase state in memory and
            Google’s own authentication cookies when you choose to sign in; the Google token is not
            kept in browser storage.
          </p>
          <h2>Your controls</h2>
          <p>
            You can remove or block cookies and local storage in your browser settings. Clearing
            tg_player means this browser can no longer reconnect to its previous anonymous progress;
            it does not itself delete the server records. Blocking essential cookies can stop
            gameplay or sign-in from working. You can delete your trips from My trips. Other data
            rights are described in the <a href="/privacy">Privacy notice</a>.
          </p>
          <p>
            External map and sign-in providers process network requests under their own privacy
            notices. If we add optional tracking in future, we will update this notice and introduce
            the required choices before enabling it.
          </p>
        </>
      )}
    </main>
  );
}
