export default function PhotoCredit({ credit }) {
  if (!credit) return null;
  return (
    <details className="photo-credit">
      <summary>Photo credit</summary>
      <p>
        {credit.title} · {credit.author}
      </p>
      <p>
        <a href={credit.source} target="_blank" rel="noopener noreferrer">
          Original photo
        </a>{' '}
        ·{' '}
        <a href={credit.licenseUrl} target="_blank" rel="noopener noreferrer">
          {credit.license}
        </a>
      </p>
      <small>{credit.changes || 'Resized and re-encoded; metadata removed.'}</small>
    </details>
  );
}
