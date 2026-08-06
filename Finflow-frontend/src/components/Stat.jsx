/**
 * One headline figure.
 *
 * `tone` colours the delta, not the label: green and red carry meaning about
 * the number, so they are never the only signal — the sign is always printed
 * too, for anyone who cannot distinguish them.
 */
export function Stat({ label, value, delta, tone = "neutral", footnote }) {
  return (
    <div className="stat">
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      {delta ? <p className={`stat-delta tone-${tone}`}>{delta}</p> : null}
      {footnote ? <p className="stat-foot muted">{footnote}</p> : null}
    </div>
  );
}
