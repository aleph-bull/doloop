import { Glass } from '@komogon/ui';
import { useQuote } from '../lib/queries';

/**
 * The quote or research tip of the moment, a new one every six hours (spec §12, made
 * more frequent on request). Never shows a quote without attribution. It stays up whether
 * or not a tip about the app is showing (TipCard), and closing a tip leaves it as it is.
 * `inline` renders it as a footer inside another panel, under a rule, rather than as a
 * card of its own.
 */
export function QuoteCard({ inline = false }: { inline?: boolean }) {
  const q = useQuote();
  const pick = q.data?.pick;
  if (!pick) return null;
  const body = (
    <>
      <p
        className={inline ? 'text-base leading-snug italic' : 'text-lg leading-snug italic'}
        style={{ letterSpacing: 'var(--tracking-tight)' }}
      >
        {pick.kind === 'quote' ? `“${pick.item.text}”` : pick.item.text}
      </p>
      <p className="muted text-sm" style={{ marginTop: 6 }}>
        {pick.kind === 'quote' ? pick.item.author : pick.item.citation}
      </p>
    </>
  );
  if (inline)
    return (
      <div className="fade-in" role="note" aria-label="Quote">
        <div className="divider" style={{ marginTop: 4 }} />
        {body}
      </div>
    );
  return (
    <Glass className="p-5 fade-in" as="section" aria-label="Quote">
      {body}
    </Glass>
  );
}
