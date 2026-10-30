import { cn } from '@komogon/ui';
import { tierStyle } from '../../lib/rolls';

/**
 * A crate, drawn plainly in its title's colour (owner: "simple drawings coloured the title's
 * colour"): a box with two straps, a lid and a latch. The lid is its own group so an opening
 * can lift it off.
 */
export function CrateArt({ tier, className }: { tier: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 64 56"
      className={cn('crate-art', className)}
      style={tierStyle(tier)}
      aria-hidden
    >
      <g className="crate-body">
        <rect x="7" y="19" width="50" height="33" rx="4" className="crate-fill" />
        <path d="M7 30.5h50M7 41h50" className="crate-line" />
        <path d="M20 21v29M44 21v29" className="crate-strap" />
      </g>
      <g className="crate-lid">
        <rect x="4" y="9" width="56" height="12" rx="3.5" className="crate-top" />
        <path d="M20 11v8M44 11v8" className="crate-strap" />
        <rect x="27.5" y="15" width="9" height="11" rx="2" className="crate-latch" />
      </g>
    </svg>
  );
}
