import { Glass } from '@doloop/ui';
import { useQuote } from '../lib/queries';

/** Daily quote or research tip (spec §12). Never shows a quote without attribution. */
export function QuoteCard() {
  const q = useQuote();
  const pick = q.data?.pick;
  if (!pick) return null;
  return (
    <Glass className="p-5 fade-in" as="section" aria-label="Daily quote">
      <p className="text-lg leading-snug" style={{ letterSpacing: 'var(--tracking-tight)' }}>
        {pick.kind === 'quote' ? `“${pick.item.text}”` : pick.item.text}
      </p>
      <p className="muted text-sm mt-2">
        {pick.kind === 'quote' ? pick.item.author : pick.item.citation}
      </p>
    </Glass>
  );
}
