import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Ellipsis, Share, SquarePlus } from 'lucide-react';
import { Button, Modal, Toggle } from '@komogon/ui';
import { isPhone, mobileOs } from '../lib/device';
import { askDue, canAddToHomeScreen, markAsked, onHomeScreen } from '../lib/home-screen';
import { useHints } from '../lib/hints';
import { useMe } from '../lib/queries';
import { useTour } from '../lib/tour';

/**
 * Safari's steps for putting Komogon on the Home Screen, with the symbols its buttons show.
 * Written to fit Safari old and new (iOS 26 put Share under ⋯) and Chrome on an iPhone.
 */
export function HomeScreenSteps() {
  return (
    <ol className="hs-steps">
      <li>
        <span className="hs-step-n" aria-hidden>
          1
        </span>
        <div>
          <p className="hs-step-label">
            Tap
            <span className="hs-glyph" aria-hidden>
              <Share size={16} />
            </span>
            Share
          </p>
          <p className="field-hint">
            Under
            <span className="hs-glyph" role="img" aria-label="More">
              <Ellipsis size={14} aria-hidden />
            </span>
            if you don't see it.
          </p>
        </div>
      </li>
      <li>
        <span className="hs-step-n" aria-hidden>
          2
        </span>
        <div>
          <p className="hs-step-label">
            Tap
            <span className="hs-glyph" aria-hidden>
              <SquarePlus size={16} />
            </span>
            Add to Home Screen
          </p>
          <p className="field-hint">Scroll down if you don't see it.</p>
        </div>
      </li>
      <li>
        <span className="hs-step-n" aria-hidden>
          3
        </span>
        <div>
          <p className="hs-step-label">Tap Add</p>
        </div>
      </li>
    </ol>
  );
}

function StepsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add to Home Screen"
      actions={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <HomeScreenSteps />
    </Modal>
  );
}

/** Settings › Home Screen, on an iPhone or iPad in a browser (SettingsNav hides it elsewhere). */
export function HomeScreenSettings() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <p>Opens full screen, like an app.</p>
      <div>
        <Button onClick={() => setOpen(true)}>
          <SquarePlus size={15} aria-hidden /> Add to Home Screen
        </Button>
      </div>
      {/* On the body, so the section's heading styles stay off the sheet's title. */}
      {createPortal(<StepsDialog open={open} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

/**
 * Asks on an iPhone in a browser whether to put Komogon on the Home Screen, then shows how.
 * "Not now" asks again a few days later (`askDue`); "Don't ask again" is for good, on the
 * account. Never on a tablet or a computer, over the first-time setup, while `hold` (another
 * question is due), or over any other dialog. Opening Komogon from the Home Screen counts as
 * "Don't ask again": it's there.
 */
export function HomeScreenAsk({ hold = false }: { hold?: boolean }) {
  const me = useMe();
  const tour = useTour();
  const { isDismissed, dismiss } = useHints();
  // Read once: none of these change while the page is open.
  const [eligible] = useState(() => isPhone() && canAddToHomeScreen() && askDue());
  const [installed] = useState(() => mobileOs() === 'ios' && onHomeScreen());
  const [open, setOpen] = useState(false);
  const [asked, setAsked] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const [never, setNever] = useState(false);

  const user = me.data?.user;
  const dismissed = isDismissed('home-screen');
  const ready =
    eligible && !asked && !!me.data?.onboarded && !!user && !tour && !hold && !dismissed;

  useEffect(() => {
    if (installed && user && !dismissed) dismiss('home-screen');
  }, [installed, user, dismissed, dismiss]);

  useEffect(() => {
    if (!ready) return;
    // A while after the page arrives, and only once nothing else is asking.
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (document.querySelector('dialog[open]')) return;
      window.clearInterval(timer);
      markAsked();
      setAsked(true);
      setOpen(true);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [ready]);

  if (!eligible) return null;

  const close = () => {
    if (never) dismiss('home-screen');
    setOpen(false);
  };

  // On the body: on a phone, Social's sheet would lend it its own text styles.
  return createPortal(
    <Modal
      open={open}
      onClose={close}
      title={showSteps ? 'Add to Home Screen' : 'Add Komogon to your Home Screen?'}
      actions={
        showSteps ? (
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>
              Not now
            </Button>
            <Button variant="primary" onClick={() => setShowSteps(true)}>
              Show me how
            </Button>
          </>
        )
      }
    >
      {showSteps ? (
        <HomeScreenSteps />
      ) : (
        <>
          <p>Opens full screen, like an app.</p>
          <Toggle checked={never} onChange={setNever} label="Don't ask again" />
        </>
      )}
    </Modal>,
    document.body,
  );
}
