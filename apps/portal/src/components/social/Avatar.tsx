/** The picture, or the first letter of the name on a tint of the accent. */
export function Avatar({
  name,
  url,
  size = 'md',
}: {
  name: string;
  url: string | null;
  size?: 'xs' | 'sm' | 'md';
}) {
  return (
    <span className={`profile-avatar${size === 'md' ? '' : ` is-${size}`}`} aria-hidden>
      {url ? <img src={url} alt="" /> : name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}
