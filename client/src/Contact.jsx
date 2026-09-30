import { useEffect, useState } from 'react';
import { api, json } from './api';
export default function Contact({ id, navigate }) {
  const [target, setTarget] = useState(new URLSearchParams(location.search).get('target') || ''),
    [category, setCategory] = useState('service'),
    [name, setName] = useState(''),
    [email, setEmail] = useState(''),
    [message, setMessage] = useState(''),
    [goodFaith, setGoodFaith] = useState(false),
    [receipt, setReceipt] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [supportEmail, setSupportEmail] = useState(null);
  const token = location.hash.slice(1),
    headers = { 'X-Report-Token': token };
  useEffect(() => {
    api('/community/config')
      .then((d) => setSupportEmail(d.supportEmail))
      .catch(() => {});
    if (id)
      api(`/reports/${id}`, { headers })
        .then(setReceipt)
        .catch((e) => setError(e.message));
  }, [id]);
  const normalizeTarget = (value) => {
    try {
      return value.startsWith('http') ? new URL(value).pathname : value;
    } catch {
      return value;
    }
  };
  return (
    <main className="contact-page narrow-page">
      <h1>{id ? 'Private report receipt' : 'Contact and reports'}</h1>
      <p>
        Contact the TripGuessr operator about copyright, privacy, content, account data, or a
        service issue. Messages are reviewed by a person. English and Polish are welcome.
      </p>
      {supportEmail && (
        <p>
          You can also email <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.
        </p>
      )}
      {id && !receipt ? (
        <p>{error || 'Loading receipt…'}</p>
      ) : (
        <>
          {receipt && (
            <>
              <p className="small-note">
                Keep this private link to read replies or request a review. Anyone with the complete
                receipt link can read this conversation. It is not listed on the site.
              </p>
              <label>
                Private receipt link
                <input readOnly value={location.href} onFocus={(e) => e.target.select()} />
              </label>
              <p>
                Status: <strong>{receipt.status}</strong>
              </p>
              <div className="report-thread">
                {receipt.messages.map((m, i) => (
                  <article className="panel" key={i}>
                    <strong>{m.by}</strong>
                    <small>{new Date(m.at).toLocaleString()}</small>
                    <p>{m.text}</p>
                  </article>
                ))}
              </div>
              <button
                className="text-button"
                onClick={() =>
                  api(`/reports/${id}`, { headers })
                    .then(setReceipt)
                    .catch((e) => setError(e.message))
                }
              >
                Check for replies
              </button>
            </>
          )}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              try {
                if (id) {
                  setReceipt(
                    await api(`/reports/${id}/replies`, { ...json('POST', { message }), headers }),
                  );
                  setMessage('');
                } else {
                  const d = await api(
                    '/reports',
                    json('POST', {
                      target: normalizeTarget(target),
                      category,
                      name,
                      email,
                      message,
                      goodFaith,
                    }),
                  );
                  navigate(d.url);
                }
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {!id && (
              <>
                <label>
                  What is this about?
                  <select value={category} onChange={(e) => setCategory(e.target.value)}>
                    {[
                      ['service', 'Service / account request'],
                      ['copyright', 'Copyright'],
                      ['privacy', 'Privacy'],
                      ['illegal', 'Illegal content'],
                      ['nickname', 'Nickname or impersonation'],
                      ['appeal', 'Review a moderation decision'],
                    ].map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Trip or previous receipt link (if relevant)
                  <input
                    maxLength={250}
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                  />
                </label>
                <label>
                  Your name (optional)
                  <input
                    maxLength={100}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                  />
                </label>
                <label>
                  Contact email (optional)
                  <input
                    type="email"
                    maxLength={254}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                  />
                </label>
                <p className="small-note">
                  For a formal legal notice, include your name, email, the precise content and why
                  you believe it is unlawful. Avoid unnecessary personal information. You can also
                  use the private receipt to communicate without an email address.
                </p>
              </>
            )}
            <label>
              {id ? 'Reply or request review' : 'Describe the issue'}
              <textarea
                required
                maxLength={4000}
                rows={6}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </label>
            {!id && (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  required
                  checked={goodFaith}
                  onChange={(e) => setGoodFaith(e.target.checked)}
                />
                This report is accurate and complete to the best of my knowledge.
              </label>
            )}
            <button className="button" disabled={busy}>
              {busy ? 'Sending…' : id ? 'Send reply' : 'Send and get private receipt'}
            </button>
          </form>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="small-note">
        Reports are private. Closed threads are normally deleted after 180 days, unless needed for a
        specific dispute. <a href="/privacy">Privacy notice</a>
      </p>
    </main>
  );
}
