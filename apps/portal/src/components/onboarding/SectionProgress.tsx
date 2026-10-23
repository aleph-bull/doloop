const SECTIONS = ['About you', 'Look around', 'Timelapse'];

/** The setup's three parts as bars, the current one filling as it goes. */
export function SectionProgress({ section, progress }: { section: number; progress: number }) {
  return (
    <ol className="ob-sections" aria-label="Setup">
      {SECTIONS.map((name, i) => {
        const fill = i < section ? 1 : i === section ? Math.min(1, Math.max(0, progress)) : 0;
        return (
          <li
            key={name}
            className={i === section ? 'is-here' : undefined}
            aria-current={i === section ? 'step' : undefined}
          >
            <span className="ob-section-bar" aria-hidden>
              <span style={{ transform: `scaleX(${fill})` }} />
            </span>
            <span className="ob-section-name">{name}</span>
          </li>
        );
      })}
    </ol>
  );
}
